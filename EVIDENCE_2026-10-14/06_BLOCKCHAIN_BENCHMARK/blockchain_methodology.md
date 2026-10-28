# Blockchain Gas and Latency Methodology

## Status: BLOCKED

This experiment requires live Sepolia testnet access and a funded wallet.

## What the Experiment Would Do

For each operation (N=3 runs each):
1. Submit transaction to Sepolia via Alchemy/Infura RPC
2. Wait for 1-block confirmation (tx.wait(1))
3. Record: gasUsed (from receipt), blockNumber, txHash, submission timestamp, confirmation timestamp
4. Compute confirmation latency = confirmationTimestamp − submissionTimestamp

## Operations Covered

| Operation              | Type  | Gas Usage (estimated, not measured) |
|------------------------|-------|-------------------------------------|
| registerFile()         | Write | ~100,000–150,000 gas (estimated)    |
| requestAccess()        | Write | ~80,000–100,000 gas (estimated)     |
| approveAccess()        | Write | ~80,000–100,000 gas (estimated)     |
| rejectAccess()         | Write | ~60,000–80,000 gas (estimated)      |
| revokeAccess()         | Write | ~60,000–80,000 gas (estimated)      |
| checkAccess()          | Read  | 0 gas (eth_call)                    |
| verifyFileHashOnChain()| Read  | 0 gas (eth_call)                    |

**IMPORTANT:** These are design-level estimates, NOT measured values from receipts.
Do not cite these in the paper as experimental results.

## Prerequisites

- Live Alchemy/Infura Sepolia RPC endpoint
- Funded Sepolia wallet (SepoliaETH available from faucets)
- Explicit user authorization to submit transactions

## Note on Sepolia ETH

SepoliaETH is test ETH with no monetary value. Cost figures in the paper, if any,
should clarify this (e.g., "no real monetary cost on testnet").
