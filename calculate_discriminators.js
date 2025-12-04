const { createHash } = require('crypto');

function getDiscriminator(name) {
    const hash = createHash('sha256').update(`global:${name}`).digest();
    return Array.from(hash.slice(0, 8));
}

console.log('create_escrow:', getDiscriminator('create_escrow'));
console.log('deposit_asset:', getDiscriminator('deposit_asset'));
console.log('buy_asset:', getDiscriminator('buy_asset'));
console.log('cancel_escrow:', getDiscriminator('cancel_escrow'));
