// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {KumuleNFT} from "../src/KumuleNFT.sol";
import {KumuleMarket} from "../src/KumuleMarket.sol";

/// Deploys both UUPS proxies to Base Sepolia.
///
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url https://sepolia.base.org \
///     --private-key $PK --broadcast
///
/// Owner and treasury both default to the deployer. MINT_FEE_WEI and MARKET_FEE_BPS are
/// optional overrides.
contract Deploy is Script {
    function run() external {
        address deployer = msg.sender;
        address owner = vm.envOr("OWNER", deployer);
        address treasury = vm.envOr("TREASURY", deployer);
        uint256 mintFee = vm.envOr("MINT_FEE_WEI", uint256(0));
        uint96 marketFeeBps = uint96(vm.envOr("MARKET_FEE_BPS", uint256(250)));

        vm.startBroadcast();

        KumuleNFT nftImpl = new KumuleNFT();
        KumuleNFT nft = KumuleNFT(
            address(
                new ERC1967Proxy(
                    address(nftImpl),
                    abi.encodeCall(KumuleNFT.initialize, ("Kumule", "KUM", owner, treasury))
                )
            )
        );

        KumuleMarket marketImpl = new KumuleMarket();
        KumuleMarket market = KumuleMarket(
            address(
                new ERC1967Proxy(
                    address(marketImpl),
                    abi.encodeCall(KumuleMarket.initialize, (owner, treasury, marketFeeBps))
                )
            )
        );

        if (mintFee != 0 && owner == deployer) nft.setMintFee(mintFee);

        vm.stopBroadcast();

        console.log("chainId          ", block.chainid);
        console.log("deployer         ", deployer);
        console.log("owner            ", owner);
        console.log("treasury         ", treasury);
        console.log("KumuleNFT proxy  ", address(nft));
        console.log("KumuleNFT impl   ", address(nftImpl));
        console.log("KumuleMarket prxy", address(market));
        console.log("KumuleMarket impl", address(marketImpl));
        console.log("marketFeeBps     ", marketFeeBps);
        console.log("mintFeeWei       ", nft.mintFee());
    }
}
