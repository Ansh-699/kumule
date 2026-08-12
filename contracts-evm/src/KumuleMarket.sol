// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from
    "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/// @title KumuleMarket
/// @notice Approval-based ERC-721 marketplace. The contract never takes custody: a seller
///         approves it, the listing is bookkeeping, and `buy` moves NFT and ETH in one
///         transaction. If the seller transfers or un-approves the token, `buy` reverts and
///         nobody is left holding an asset they cannot retrieve.
/// @dev Works with any ERC-721, not just KumuleNFT, so imported collections are tradable too.
///      UUPS upgradeable; storage is append-only.
contract KumuleMarket is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    struct Listing {
        address seller;
        address nft;
        uint256 tokenId;
        uint256 price;
        bool active;
    }

    /// @notice Marketplace cut in basis points, taken from seller proceeds.
    uint96 public feeBps;

    /// @notice Hard ceiling on feeBps so an upgrade or a fat finger cannot set 100%.
    uint96 public constant MAX_FEE_BPS = 1000; // 10%

    address public treasury;

    mapping(uint256 => Listing) public listings;

    /// @notice listingId of the live listing for a token, or 0. Blocks double-listing.
    mapping(address => mapping(uint256 => uint256)) public activeListingOf;

    uint256 private _nextListingId;

    uint256[45] private __gap;

    event Listed(
        uint256 indexed listingId, address indexed seller, address indexed nft, uint256 tokenId, uint256 price
    );
    event PriceUpdated(uint256 indexed listingId, uint256 oldPrice, uint256 newPrice);
    event Cancelled(uint256 indexed listingId);
    event Purchased(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        address nft,
        uint256 tokenId,
        uint256 price,
        uint256 fee
    );
    event FeeUpdated(uint96 oldBps, uint96 newBps);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroPrice();
    error NotERC721();
    error NotTokenOwner();
    error MarketNotApproved();
    error AlreadyListed(uint256 listingId);
    error ListingNotActive();
    error NotSeller();
    error WrongPayment(uint256 expected, uint256 provided);
    error CannotBuyOwnListing();
    error SellerNoLongerOwns();
    error FeeTooHigh(uint96 max);
    error NothingToWithdraw();
    error TransferFailed();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address treasury_, uint96 feeBps_) external initializer {
        if (initialOwner == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh(MAX_FEE_BPS);
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        treasury = treasury_;
        feeBps = feeBps_;
        _nextListingId = 1;
    }

    // --- selling ---

    function list(address nft, uint256 tokenId, uint256 price) external returns (uint256 listingId) {
        if (nft == address(0)) revert ZeroAddress();
        if (price == 0) revert ZeroPrice();
        if (!IERC165(nft).supportsInterface(type(IERC721).interfaceId)) revert NotERC721();
        if (IERC721(nft).ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        // Checked up front so a listing is only created when it can actually be filled.
        // `buy` re-checks, because approval can be revoked afterwards.
        if (!_isApproved(nft, tokenId, msg.sender)) revert MarketNotApproved();

        uint256 existing = activeListingOf[nft][tokenId];
        if (existing != 0 && listings[existing].active) revert AlreadyListed(existing);

        listingId = _nextListingId++;
        listings[listingId] =
            Listing({seller: msg.sender, nft: nft, tokenId: tokenId, price: price, active: true});
        activeListingOf[nft][tokenId] = listingId;

        emit Listed(listingId, msg.sender, nft, tokenId, price);
    }

    function updatePrice(uint256 listingId, uint256 newPrice) external {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive();
        if (l.seller != msg.sender) revert NotSeller();
        if (newPrice == 0) revert ZeroPrice();
        emit PriceUpdated(listingId, l.price, newPrice);
        l.price = newPrice;
    }

    /// @notice Cancel a listing. The seller may always cancel. Anyone may cancel a listing whose
    ///         seller no longer owns the token, since it can never be filled and would otherwise
    ///         block relisting forever.
    function cancel(uint256 listingId) external {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive();

        if (l.seller != msg.sender) {
            if (IERC721(l.nft).ownerOf(l.tokenId) == l.seller) revert NotSeller();
        }

        l.active = false;
        delete activeListingOf[l.nft][l.tokenId];
        emit Cancelled(listingId);
    }

    // --- buying ---

    function buy(uint256 listingId) external payable nonReentrant {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingNotActive();
        if (msg.sender == l.seller) revert CannotBuyOwnListing();
        // Exact payment only. Accepting more would silently keep the surplus.
        if (msg.value != l.price) revert WrongPayment(l.price, msg.value);
        if (IERC721(l.nft).ownerOf(l.tokenId) != l.seller) revert SellerNoLongerOwns();

        address seller = l.seller;
        address nft = l.nft;
        uint256 tokenId = l.tokenId;
        uint256 price = l.price;

        // State cleared before any external call, so a reentrant buy finds an inactive listing
        // even setting the guard aside.
        l.active = false;
        delete activeListingOf[nft][tokenId];

        uint256 fee = (price * feeBps) / 10_000;
        uint256 proceeds = price - fee;

        // NFT first: if the seller revoked approval this reverts and the buyer keeps their ETH.
        IERC721(nft).safeTransferFrom(seller, msg.sender, tokenId);

        (bool ok,) = seller.call{value: proceeds}("");
        if (!ok) revert TransferFailed();

        emit Purchased(listingId, msg.sender, seller, nft, tokenId, price, fee);
    }

    // --- views ---

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    /// @notice True when the listing exists, is active, and would actually fill right now.
    function isFillable(uint256 listingId) external view returns (bool) {
        Listing memory l = listings[listingId];
        if (!l.active) return false;
        if (IERC721(l.nft).ownerOf(l.tokenId) != l.seller) return false;
        return _isApproved(l.nft, l.tokenId, l.seller);
    }

    function totalListings() external view returns (uint256) {
        return _nextListingId - 1;
    }

    // --- admin ---

    function setFeeBps(uint96 newBps) external onlyOwner {
        if (newBps > MAX_FEE_BPS) revert FeeTooHigh(MAX_FEE_BPS);
        emit FeeUpdated(feeBps, newBps);
        feeBps = newBps;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();
        address to = treasury;
        emit FeesWithdrawn(to, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _isApproved(address nft, uint256 tokenId, address holder) private view returns (bool) {
        return IERC721(nft).isApprovedForAll(holder, address(this))
            || IERC721(nft).getApproved(tokenId) == address(this);
    }
}
