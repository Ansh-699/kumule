// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {KumuleNFT} from "../src/KumuleNFT.sol";

/// Minimal v2 used only to prove an upgrade preserves storage and gates on ownership.
contract KumuleNFTV2 is KumuleNFT {
    function version() external pure returns (string memory) {
        return "v2";
    }
}

contract KumuleNFTTest is Test {
    KumuleNFT nft;
    address owner = address(0xA11CE);
    address treasury = address(0x7EA);
    address alice = address(0xA1);
    address bob = address(0xB0B);

    string constant URI = "https://cdn.kumule.dev/metadata/1.json";

    function setUp() public {
        KumuleNFT impl = new KumuleNFT();
        bytes memory init =
            abi.encodeCall(KumuleNFT.initialize, ("Kumule", "KUM", owner, treasury));
        nft = KumuleNFT(address(new ERC1967Proxy(address(impl), init)));
    }

    function test_initialize_setsState() public view {
        assertEq(nft.name(), "Kumule");
        assertEq(nft.symbol(), "KUM");
        assertEq(nft.owner(), owner);
        assertEq(nft.treasury(), treasury);
        assertEq(nft.mintFee(), 0);
        assertEq(nft.totalMinted(), 0);
    }

    function test_initialize_cannotRunTwice() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        nft.initialize("X", "X", owner, treasury);
    }

    function test_implementation_cannotBeInitialized() public {
        KumuleNFT impl = new KumuleNFT();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize("X", "X", owner, treasury);
    }

    function test_mint_freeWhenNoFee() public {
        vm.prank(alice);
        uint256 id = nft.mint(alice, URI);
        assertEq(id, 1);
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.tokenURI(1), URI);
        assertEq(nft.totalMinted(), 1);
    }

    function test_mint_idsStartAtOneAndIncrement() public {
        vm.startPrank(alice);
        assertEq(nft.mint(alice, URI), 1);
        assertEq(nft.mint(alice, URI), 2);
        assertEq(nft.mint(alice, URI), 3);
        vm.stopPrank();
        assertEq(nft.totalMinted(), 3);
    }

    function test_mint_rejectsEmptyUri() public {
        // The v1 failure mode this exists to prevent: 152 tokens with no resolvable image.
        vm.prank(alice);
        vm.expectRevert(KumuleNFT.EmptyTokenURI.selector);
        nft.mint(alice, "");
    }

    function test_mint_rejectsZeroAddress() public {
        vm.prank(alice);
        vm.expectRevert(KumuleNFT.ZeroAddress.selector);
        nft.mint(address(0), URI);
    }

    function test_mint_requiresFee() public {
        vm.prank(owner);
        nft.setMintFee(0.01 ether);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KumuleNFT.InsufficientMintFee.selector, 0.01 ether, 0.005 ether));
        nft.mint{value: 0.005 ether}(alice, URI);

        vm.prank(alice);
        nft.mint{value: 0.01 ether}(alice, URI);
        assertEq(nft.ownerOf(1), alice);
        assertEq(address(nft).balance, 0.01 ether);
    }

    function test_mint_ownerPaysNoFee() public {
        // The backend mints medals into the vault as owner; charging itself would be absurd.
        vm.prank(owner);
        nft.setMintFee(1 ether);
        vm.prank(owner);
        nft.mint(bob, URI);
        assertEq(nft.ownerOf(1), bob);
    }

    function test_setMintFee_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, alice));
        nft.setMintFee(1 ether);
    }

    function test_setTreasury_rejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(KumuleNFT.ZeroAddress.selector);
        nft.setTreasury(address(0));
    }

    function test_withdrawFees_sendsToTreasury() public {
        vm.prank(owner);
        nft.setMintFee(0.5 ether);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        nft.mint{value: 0.5 ether}(alice, URI);

        uint256 before = treasury.balance;
        vm.prank(owner);
        nft.withdrawFees();
        assertEq(treasury.balance - before, 0.5 ether);
        assertEq(address(nft).balance, 0);
    }

    function test_withdrawFees_revertsWhenEmpty() public {
        vm.prank(owner);
        vm.expectRevert(KumuleNFT.NothingToWithdraw.selector);
        nft.withdrawFees();
    }

    function test_upgrade_onlyOwner() public {
        KumuleNFTV2 v2 = new KumuleNFTV2();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, alice));
        nft.upgradeToAndCall(address(v2), "");
    }

    function test_upgrade_preservesState() public {
        vm.prank(alice);
        nft.mint(alice, URI);
        vm.prank(owner);
        nft.setMintFee(0.02 ether);

        KumuleNFTV2 v2 = new KumuleNFTV2();
        vm.prank(owner);
        nft.upgradeToAndCall(address(v2), "");

        assertEq(KumuleNFTV2(address(nft)).version(), "v2");
        assertEq(nft.ownerOf(1), alice, "token survived upgrade");
        assertEq(nft.tokenURI(1), URI, "uri survived upgrade");
        assertEq(nft.mintFee(), 0.02 ether, "fee survived upgrade");
        assertEq(nft.owner(), owner);
        // Ids keep going rather than restarting, proving the counter slot was not clobbered.
        // The fee survived the upgrade too, so this mint has to actually pay it.
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        assertEq(nft.mint{value: 0.02 ether}(alice, URI), 2);
    }

    function test_supportsInterface() public view {
        assertTrue(nft.supportsInterface(0x80ac58cd), "ERC721");
        assertTrue(nft.supportsInterface(0x5b5e139f), "ERC721Metadata");
        assertTrue(nft.supportsInterface(0x01ffc9a7), "ERC165");
    }

    function testFuzz_mint_anyNonEmptyUri(string calldata uri) public {
        vm.assume(bytes(uri).length > 0);
        vm.prank(alice);
        uint256 id = nft.mint(alice, uri);
        assertEq(nft.tokenURI(id), uri);
    }
}
