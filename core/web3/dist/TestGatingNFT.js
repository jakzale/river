import { createTestClient, http, publicActions, walletActions } from 'viem';
import { foundry } from 'viem/chains';
import MockERC721a from './MockERC721A';
import { keccak256 } from 'viem/utils';
import { dlogger } from '@river-build/dlog';
const logger = dlogger('csb:TestGatingNFT');
export function toEIP55Address(address) {
    const addressHash = keccak256(address.substring(2).toLowerCase());
    let checksumAddress = '0x';
    for (let i = 2; i < address.length; i++) {
        if (parseInt(addressHash[i], 16) >= 8) {
            checksumAddress += address[i].toUpperCase();
        }
        else {
            checksumAddress += address[i].toLowerCase();
        }
    }
    return checksumAddress;
}
export function isEIP55Address(address) {
    return address === toEIP55Address(address);
}
/*
 */
export function isHexString(value) {
    // Check if the value is undefined first
    if (value === undefined) {
        return false;
    }
    return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value);
}
export class TestGatingNFT {
    async publicMint(toAddress) {
        if (!isHexString(toAddress)) {
            throw new Error('Invalid address');
        }
        return await publicMint('TestGatingNFT', toAddress);
    }
}
class Mutex {
    queue;
    locked;
    constructor() {
        this.queue = [];
        this.locked = false;
    }
    lock() {
        if (!this.locked) {
            this.locked = true;
            return Promise.resolve();
        }
        let unlockNext;
        const promise = new Promise((resolve) => {
            unlockNext = resolve;
        });
        this.queue.push(unlockNext);
        return promise;
    }
    unlock() {
        if (this.queue.length > 0) {
            const unlockNext = this.queue.shift();
            unlockNext?.();
        }
        else {
            this.locked = false;
        }
    }
}
const nftContracts = new Map();
const nftContractsMutex = new Mutex();
export async function getContractAddress(nftName) {
    let retryCount = 0;
    let lastError;
    try {
        // If mulitple callers are in a Promise.all() and they all try to deploy the same contract at the same time,
        // we want to make sure that only one of them actually deploys the contract.
        await nftContractsMutex.lock();
        if (!nftContracts.has(nftName)) {
            while (retryCount++ < 5) {
                try {
                    const client = createTestClient({
                        chain: foundry,
                        mode: 'anvil',
                        transport: http(),
                    })
                        .extend(publicActions)
                        .extend(walletActions);
                    const account = (await client.getAddresses())[0];
                    const hash = await client.deployContract({
                        abi: MockERC721a.abi,
                        account,
                        bytecode: MockERC721a.bytecode.object,
                    });
                    const receipt = await client.waitForTransactionReceipt({ hash });
                    if (receipt.contractAddress) {
                        logger.info('deployed', nftName, receipt.contractAddress, isEIP55Address(receipt.contractAddress), nftContracts);
                        // For some reason the address isn't in EIP-55, so we need to checksum it
                        nftContracts.set(nftName, toEIP55Address(receipt.contractAddress));
                    }
                    else {
                        throw new Error('Failed to deploy contract');
                    }
                    break;
                }
                catch (e) {
                    lastError = e;
                    if (typeof e === 'object' &&
                        e !== null &&
                        'message' in e &&
                        typeof e.message === 'string' &&
                        (e.message.includes('nonce too low') ||
                            e.message.includes('NonceTooLowError') ||
                            e.message.includes('Nonce provided for the transaction is lower than the current nonce'))) {
                        logger.log('retrying because nonce too low', e, retryCount);
                    }
                    else {
                        throw e;
                    }
                }
            }
        }
    }
    finally {
        nftContractsMutex.unlock();
    }
    const contractAddress = nftContracts.get(nftName);
    if (!contractAddress) {
        throw new Error(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Failed to get contract address: ${nftName} retryCount: ${retryCount} lastError: ${lastError} `);
    }
    return contractAddress;
}
export async function getTestGatingNFTContractAddress() {
    return await getContractAddress('TestGatingNFT');
}
export async function publicMint(nftName, toAddress) {
    const client = createTestClient({
        chain: foundry,
        mode: 'anvil',
        transport: http(),
    })
        .extend(publicActions)
        .extend(walletActions);
    const contractAddress = await getContractAddress(nftName);
    logger.log('minting', contractAddress, toAddress);
    const account = (await client.getAddresses())[0];
    const nftReceipt = await client.writeContract({
        address: contractAddress,
        abi: MockERC721a.abi,
        functionName: 'mint',
        args: [toAddress, 1n],
        account,
    });
    await client.waitForTransactionReceipt({ hash: nftReceipt });
}
//# sourceMappingURL=TestGatingNFT.js.map