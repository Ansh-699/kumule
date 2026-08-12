// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ERC721URIStorageUpgradeable} from
    "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title KumuleNFT
/// @notice Upgradeable ERC-721 for the Kumule marketplace on Base. Each token carries its own
///         metadata URI, because every mint is user-supplied art rather than a slice of one
///         pre-baked collection.
/// @dev UUPS. Storage is append-only: new state goes at the end and the gap below shrinks,
///      never the reverse. Run `forge inspect KumuleNFT storageLayout` before any upgrade.
contract KumuleNFT is ERC721Upgradeable, ERC721URIStorageUpgradeable, OwnableUpgradeable, UUPSUpgradeable {
    /// @notice Fee, in wei, a non-owner pays to mint. Zero means minting is free.
    uint256 public mintFee;

    /// @notice Where mint fees accumulate for withdrawal.
    address public treasury;

    /// @dev Next id to assign. Starts at 1 so id 0 can mean "unset" in consumers.
    uint256 private _nextTokenId;

    /// @dev Reserved so later versions can add state without shifting existing slots.
    uint256[46] private __gap;

    event Minted(uint256 indexed tokenId, address indexed to, string uri);
    event MintFeeUpdated(uint256 oldFee, uint256 newFee);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error InsufficientMintFee(uint256 required, uint256 provided);
    error EmptyTokenURI();
    error ZeroAddress();
    error NothingToWithdraw();
    error TransferFailed();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(string memory name_, string memory symbol_, address initialOwner, address treasury_)
        external
        initializer
    {
        if (initialOwner == address(0) || treasury_ == address(0)) revert ZeroAddress();
        __ERC721_init(name_, symbol_);
        __ERC721URIStorage_init();
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        treasury = treasury_;
        _nextTokenId = 1;
    }

    /// @notice Mint to `to` with `uri`. Anyone may call; the owner mints free so the backend
    ///         can create medal NFTs into the vault without paying itself a fee.
    function mint(address to, string calldata uri) external payable returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        // A token with no metadata renders as a blank card. v1 shipped 152 of those; reject at
        // the source instead of filtering them out downstream forever.
        if (bytes(uri).length == 0) revert EmptyTokenURI();

        if (msg.sender != owner() && msg.value < mintFee) {
            revert InsufficientMintFee(mintFee, msg.value);
        }

        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit Minted(tokenId, to, uri);
    }

    /// @notice Total minted so far. Also the highest assigned id, since ids never skip.
    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function setMintFee(uint256 newFee) external onlyOwner {
        emit MintFeeUpdated(mintFee, newFee);
        mintFee = newFee;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function withdrawFees() external onlyOwner {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();
        address to = treasury;
        emit FeesWithdrawn(to, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // --- multiple-inheritance disambiguation ---

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721Upgradeable, ERC721URIStorageUpgradeable)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Upgradeable, ERC721URIStorageUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
