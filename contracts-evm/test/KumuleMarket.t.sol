// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from
    "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {KumuleNFT} from "../src/KumuleNFT.sol";
import {KumuleMarket} from "../src/KumuleMarket.sol";

/// Seller that tries to reenter buy() from its ETH-receive hook.
contract ReentrantSeller is IERC721Receiver {
    KumuleMarket immutable market;
    uint256 public listingId;
    bool public reentered;

    constructor(KumuleMarket m) {
        market = m;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function doList(address nft, uint256 tokenId, uint256 price) external {
        KumuleNFT(nft).setApprovalForAll(address(market), true);
        listingId = market.list(nft, tokenId, price);
    }

    receive() external payable {
        if (!reentered) {
            reentered = true;
            // Should fail: the guard is held and the listing is already inactive.
            try market.buy{value: msg.value}(listingId) {} catch {}
        }
    }
}

/// Seller that rejects ETH, so payout must fail loudly rather than silently.
contract RejectingSeller is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function approveAndList(KumuleMarket m, address nft, uint256 tokenId, uint256 price)
        external
        returns (uint256)
    {
        KumuleNFT(nft).setApprovalForAll(address(m), true);
        return m.list(nft, tokenId, price);
    }

    receive() external payable {
        revert("no thanks");
    }
}

contract NotAnNft {
    function supportsInterface(bytes4) external pure returns (bool) {
        return false;
    }
}

contract KumuleMarketTest is Test {
    KumuleNFT nft;
    KumuleMarket market;

    address owner = address(0xA11CE);
    address treasury = address(0x7EA);
    address seller = address(0x5E11);
    address buyer = address(0xB0B);

    uint96 constant FEE_BPS = 250; // 2.5%
    string constant URI = "https://cdn.kumule.dev/metadata/1.json";

    function setUp() public {
        nft = KumuleNFT(
            address(
                new ERC1967Proxy(
                    address(new KumuleNFT()),
                    abi.encodeCall(KumuleNFT.initialize, ("Kumule", "KUM", owner, treasury))
                )
            )
        );
        market = KumuleMarket(
            address(
                new ERC1967Proxy(
                    address(new KumuleMarket()),
                    abi.encodeCall(KumuleMarket.initialize, (owner, treasury, FEE_BPS))
                )
            )
        );
        vm.deal(buyer, 100 ether);
    }

    function _mintTo(address to) internal returns (uint256 id) {
        vm.prank(to);
        id = nft.mint(to, URI);
    }

    function _listAs(address who, uint256 tokenId, uint256 price) internal returns (uint256 id) {
        vm.startPrank(who);
        nft.setApprovalForAll(address(market), true);
        id = market.list(address(nft), tokenId, price);
        vm.stopPrank();
    }

    // --- listing ---

    function test_list_happyPath() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 1 ether);

        KumuleMarket.Listing memory l = market.getListing(id);
        assertEq(l.seller, seller);
        assertEq(l.nft, address(nft));
        assertEq(l.tokenId, tokenId);
        assertEq(l.price, 1 ether);
        assertTrue(l.active);
        assertEq(market.activeListingOf(address(nft), tokenId), id);
        assertTrue(market.isFillable(id));
        // Custody stays with the seller. That is the whole point of approval-based listing.
        assertEq(nft.ownerOf(tokenId), seller);
    }

    function test_list_rejectsNonOwner() public {
        uint256 tokenId = _mintTo(seller);
        vm.prank(buyer);
        vm.expectRevert(KumuleMarket.NotTokenOwner.selector);
        market.list(address(nft), tokenId, 1 ether);
    }

    function test_list_rejectsWithoutApproval() public {
        uint256 tokenId = _mintTo(seller);
        vm.prank(seller);
        vm.expectRevert(KumuleMarket.MarketNotApproved.selector);
        market.list(address(nft), tokenId, 1 ether);
    }

    function test_list_acceptsSingleTokenApproval() public {
        uint256 tokenId = _mintTo(seller);
        vm.startPrank(seller);
        nft.approve(address(market), tokenId);
        uint256 id = market.list(address(nft), tokenId, 1 ether);
        vm.stopPrank();
        assertTrue(market.isFillable(id));
    }

    function test_list_rejectsZeroPrice() public {
        uint256 tokenId = _mintTo(seller);
        vm.startPrank(seller);
        nft.setApprovalForAll(address(market), true);
        vm.expectRevert(KumuleMarket.ZeroPrice.selector);
        market.list(address(nft), tokenId, 0);
        vm.stopPrank();
    }

    function test_list_rejectsNonErc721() public {
        NotAnNft fake = new NotAnNft();
        vm.prank(seller);
        vm.expectRevert(KumuleMarket.NotERC721.selector);
        market.list(address(fake), 1, 1 ether);
    }

    function test_list_rejectsDoubleListing() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 1 ether);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(KumuleMarket.AlreadyListed.selector, id));
        market.list(address(nft), tokenId, 2 ether);
    }

    function test_updatePrice_onlySeller() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 1 ether);

        vm.prank(buyer);
        vm.expectRevert(KumuleMarket.NotSeller.selector);
        market.updatePrice(id, 2 ether);

        vm.prank(seller);
        market.updatePrice(id, 3 ether);
        assertEq(market.getListing(id).price, 3 ether);
    }

    // --- buying ---

    function test_buy_transfersNftAndSplitsEth() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 10 ether);

        uint256 sellerBefore = seller.balance;
        vm.prank(buyer);
        market.buy{value: 10 ether}(id);

        uint256 expectedFee = (10 ether * FEE_BPS) / 10_000; // 0.25
        assertEq(nft.ownerOf(tokenId), buyer, "buyer owns it");
        assertEq(seller.balance - sellerBefore, 10 ether - expectedFee, "seller got proceeds");
        assertEq(address(market).balance, expectedFee, "market kept the fee");
        assertFalse(market.getListing(id).active, "listing closed");
        assertEq(market.activeListingOf(address(nft), tokenId), 0, "relisting unblocked");
    }

    function test_buy_rejectsWrongPayment() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 1 ether);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(KumuleMarket.WrongPayment.selector, 1 ether, 0.5 ether));
        market.buy{value: 0.5 ether}(id);

        // Overpaying is refused too, rather than pocketing the surplus.
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(KumuleMarket.WrongPayment.selector, 1 ether, 2 ether));
        market.buy{value: 2 ether}(id);
    }

    function test_buy_rejectsOwnListing() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 1 ether);
        vm.deal(seller, 5 ether);
        vm.prank(seller);
        vm.expectRevert(KumuleMarket.CannotBuyOwnListing.selector);
        market.buy{value: 1 ether}(id);
    }

    function test_buy_revertsIfSellerMovedToken() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 1 ether);

        vm.prank(seller);
        nft.transferFrom(seller, address(0xDEAD), tokenId);

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        vm.expectRevert(KumuleMarket.SellerNoLongerOwns.selector);
        market.buy{value: 1 ether}(id);
        assertEq(buyer.balance, buyerBefore, "buyer keeps their ETH");
    }

    function test_buy_revertsIfApprovalRevoked() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 1 ether);

        vm.prank(seller);
        nft.setApprovalForAll(address(market), false);

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        vm.expectRevert(); // ERC721InsufficientApproval from the token
        market.buy{value: 1 ether}(id);
        assertEq(buyer.balance, buyerBefore, "buyer keeps their ETH");
        assertEq(nft.ownerOf(tokenId), seller);
    }

    function test_buy_revertsWhenSellerRejectsEth() public {
        RejectingSeller bad = new RejectingSeller();
        vm.prank(owner);
        nft.mint(address(bad), URI);
        uint256 tokenId = 1;

        vm.prank(address(bad));
        uint256 id = bad.approveAndList(market, address(nft), tokenId, 1 ether);

        vm.prank(buyer);
        vm.expectRevert(KumuleMarket.TransferFailed.selector);
        market.buy{value: 1 ether}(id);
        // Whole transaction unwound, so the NFT did not move either.
        assertEq(nft.ownerOf(tokenId), address(bad));
    }

    function test_buy_cannotBeReentered() public {
        ReentrantSeller attacker = new ReentrantSeller(market);
        vm.prank(owner);
        nft.mint(address(attacker), URI);
        uint256 tokenId = 1;

        vm.prank(address(attacker));
        attacker.doList(address(nft), tokenId, 1 ether);
        uint256 id = attacker.listingId();

        vm.prank(buyer);
        market.buy{value: 1 ether}(id);

        assertTrue(attacker.reentered(), "reentry was attempted");
        assertEq(nft.ownerOf(tokenId), buyer, "sold exactly once");
        // Only the single sale's fee is held; a successful reentry would have doubled it.
        assertEq(address(market).balance, (1 ether * FEE_BPS) / 10_000);
    }

    function test_buy_rejectsInactiveListing() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 1 ether);
        vm.prank(seller);
        market.cancel(id);

        vm.prank(buyer);
        vm.expectRevert(KumuleMarket.ListingNotActive.selector);
        market.buy{value: 1 ether}(id);
    }

    // --- cancelling ---

    function test_cancel_bySeller() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 1 ether);
        vm.prank(seller);
        market.cancel(id);
        assertFalse(market.getListing(id).active);
        assertEq(market.activeListingOf(address(nft), tokenId), 0);
    }

    function test_cancel_strangerBlockedWhileSellerStillOwns() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(KumuleMarket.NotSeller.selector);
        market.cancel(id);
    }

    function test_cancel_anyoneMayPruneUnfillableListing() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 1 ether);
        vm.prank(seller);
        nft.transferFrom(seller, address(0xDEAD), tokenId);

        // Otherwise a dead listing would block the new owner from ever relisting.
        vm.prank(buyer);
        market.cancel(id);
        assertFalse(market.getListing(id).active);
        assertEq(market.activeListingOf(address(nft), tokenId), 0);
    }

    function test_relistAfterSale() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 1 ether);
        vm.prank(buyer);
        market.buy{value: 1 ether}(id);

        uint256 id2 = _listAs(buyer, tokenId, 5 ether);
        assertTrue(market.isFillable(id2));
        assertEq(market.totalListings(), 2);
    }

    // --- admin ---

    function test_setFeeBps_capped() public {
        // Read the constant before pranking: a call inside the expectRevert argument would
        // consume the prank, and setFeeBps would run as the test contract instead of the owner.
        uint96 max = market.MAX_FEE_BPS();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(KumuleMarket.FeeTooHigh.selector, max));
        market.setFeeBps(max + 1);

        vm.prank(owner);
        market.setFeeBps(1000);
        assertEq(market.feeBps(), 1000);
    }

    function test_setFeeBps_onlyOwner() public {
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, seller));
        market.setFeeBps(100);
    }

    function test_initialize_rejectsExcessiveFee() public {
        KumuleMarket impl = new KumuleMarket();
        vm.expectRevert();
        new ERC1967Proxy(address(impl), abi.encodeCall(KumuleMarket.initialize, (owner, treasury, 5000)));
    }

    function test_withdrawFees_sendsToTreasury() public {
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 10 ether);
        vm.prank(buyer);
        market.buy{value: 10 ether}(id);

        uint256 fee = (10 ether * FEE_BPS) / 10_000;
        uint256 before = treasury.balance;
        vm.prank(owner);
        market.withdrawFees();
        assertEq(treasury.balance - before, fee);
        assertEq(address(market).balance, 0);
    }

    function test_zeroFee_sellerGetsEverything() public {
        vm.prank(owner);
        market.setFeeBps(0);
        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, 3 ether);

        uint256 before = seller.balance;
        vm.prank(buyer);
        market.buy{value: 3 ether}(id);
        assertEq(seller.balance - before, 3 ether);
        assertEq(address(market).balance, 0);
    }

    function testFuzz_feeSplitNeverExceedsPrice(uint96 bps, uint128 price) public {
        bps = uint96(bound(bps, 0, market.MAX_FEE_BPS()));
        price = uint128(bound(price, 1, 1_000 ether));
        vm.prank(owner);
        market.setFeeBps(bps);

        uint256 tokenId = _mintTo(seller);
        uint256 id = _listAs(seller, tokenId, price);

        vm.deal(buyer, uint256(price) + 1 ether);
        uint256 sellerBefore = seller.balance;
        vm.prank(buyer);
        market.buy{value: price}(id);

        uint256 fee = (uint256(price) * bps) / 10_000;
        assertEq(seller.balance - sellerBefore + fee, price, "proceeds plus fee equals price exactly");
        assertLe(fee, price);
    }
}
