#!/usr/bin/env bash
# Live end-to-end proof on Base Sepolia: list -> buy with a real second wallet.
#
# Uses publicnode rather than sepolia.base.org: the official public endpoint returns stale
# reads immediately after a write (zeroed blockHash, totalMinted still 0), and a stale read
# feeding the next call is how a whole run silently targets tokenId 0.
# Errors are never suppressed here, for the same reason.
set -euo pipefail
. ~/.kumule_env

RPC=${RPC:-https://base-sepolia-rpc.publicnode.com}
NFT=0x416e7Fd93fc2210540AAC1c1cC17a851148DfEBD
MKT=0x032774De36621265dc21056026372D7bA6f477eC
PRICE=1000000000000000   # 0.001 ETH
FEE_BPS=250

SELLER_PK=$(jq -r '.[0].private_key' ~/.config/nefto/evm.json)
SELLER=$(jq -r '.[0].address' ~/.config/nefto/evm.json)
BUYER_PK=$(jq -r '.[0].private_key' ~/.config/nefto/evm-buyer.json)
BUYER=$(jq -r '.[0].address' ~/.config/nefto/evm-buyer.json)

pass=0; fail=0
ck(){ if [ "${2,,}" = "${3,,}" ]; then echo "  PASS  $1"; pass=$((pass+1)); else echo "  FAIL  $1: got ${2} want ${3}"; fail=$((fail+1)); fi; }
call(){ cast call "$@" --rpc-url $RPC | tail -1; }

echo "seller $SELLER"
echo "buyer  $BUYER"
echo "rpc    $RPC"

echo; echo "== mint a fresh token =="
cast send $NFT 'mint(address,string)' $SELLER \
  "https://kumele-backend.ansht.workers.dev/cdn/metadata/e2e.json" \
  --private-key "$SELLER_PK" --rpc-url $RPC --json > /tmp/mint.json
# tokenId comes from the Minted event, not a follow-up read, so a lagging node cannot lie.
TID=$(jq -r '.logs[] | select(.topics[0]=="0x3b8a974a6971dbe70c8718ec80406b2790d2aa5477b6a5bed3d94fa19e06d60d") | .topics[1]' /tmp/mint.json | head -1)
TID=$((TID))
echo "minted tokenId $TID"
ck "seller owns the fresh token" "$(call $NFT 'ownerOf(uint256)(address)' $TID)" "$SELLER"

echo; echo "== approve + list at 0.001 ETH =="
APPROVED=$(call $NFT 'isApprovedForAll(address,address)(bool)' $SELLER $MKT)
[ "$APPROVED" = "true" ] || cast send $NFT 'setApprovalForAll(address,bool)' $MKT true \
  --private-key "$SELLER_PK" --rpc-url $RPC >/dev/null
cast send $MKT 'list(address,uint256,uint256)' $NFT $TID $PRICE \
  --private-key "$SELLER_PK" --rpc-url $RPC --json > /tmp/list.json
LID=$(jq -r '.logs[] | select(.topics[0]=="0x8e0b3b3ed3c1e6e1e2e5f1d0e6b0e3b2d3c0f8e9b3a1d2c3e4f5a6b7c8d9e0f1") | .topics[1]' /tmp/list.json 2>/dev/null | head -1)
LID=$(call $MKT 'totalListings()(uint256)')
echo "listingId $LID"
ck "listing is fillable" "$(call $MKT 'isFillable(uint256)(bool)' $LID)" "true"
ck "custody stays with seller" "$(call $NFT 'ownerOf(uint256)(address)' $TID)" "$SELLER"

echo; echo "== buy from the buyer wallet =="
S0=$(cast balance $SELLER --rpc-url $RPC)
M0=$(cast balance $MKT --rpc-url $RPC)
cast send $MKT 'buy(uint256)' $LID --value $PRICE --private-key "$BUYER_PK" --rpc-url $RPC >/dev/null
S1=$(cast balance $SELLER --rpc-url $RPC)
M1=$(cast balance $MKT --rpc-url $RPC)

EXP_FEE=$((PRICE * FEE_BPS / 10000))
EXP_PROCEEDS=$((PRICE - EXP_FEE))

echo; echo "== verify =="
ck "NFT transferred to buyer" "$(call $NFT 'ownerOf(uint256)(address)' $TID)" "$BUYER"
ck "seller received proceeds" "$((S1 - S0))" "$EXP_PROCEEDS"
ck "market captured the fee"  "$((M1 - M0))" "$EXP_FEE"
ck "listing no longer fillable" "$(call $MKT 'isFillable(uint256)(bool)' $LID)" "false"
ck "relisting unblocked" "$(call $MKT 'activeListingOf(address,uint256)(uint256)' $NFT $TID)" "0"

echo; echo "$pass passed, $fail failed"
exit $fail
