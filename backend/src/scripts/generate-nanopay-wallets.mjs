import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env');

if (!fs.existsSync(envPath)) {
  console.error('Error: backend/.env was not found. Create it before generating wallets.');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');

if (/^NANOPAY_BUYER_ADDRESS=/m.test(envContent)) {
  console.log('NANOPAY_BUYER_ADDRESS already exists in backend/.env. Skipping wallet generation.');
  process.exit(0);
}

const buyerWallet = ethers.Wallet.createRandom();
const sellerWallet = ethers.Wallet.createRandom();

const block = [
  '',
  '# Arc Data Piper x402 nanopayment wallets',
  `NANOPAY_BUYER_ADDRESS=${buyerWallet.address}`,
  `NANOPAY_BUYER_PRIVATE_KEY=${buyerWallet.privateKey}`,
  `NANOPAY_SELLER_ADDRESS=${sellerWallet.address}`,
  `NANOPAY_SELLER_PRIVATE_KEY=${sellerWallet.privateKey}`,
  '',
].join('\n');

fs.appendFileSync(envPath, block, 'utf8');

console.log('Nanopayment wallets generated and appended to backend/.env:');
console.log(`Buyer address:  ${buyerWallet.address}`);
console.log(`Seller address: ${sellerWallet.address}`);
