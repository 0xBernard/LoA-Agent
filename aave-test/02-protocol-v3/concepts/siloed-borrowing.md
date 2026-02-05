# Siloed Borrowing

**Siloed Borrowing** is a risk mitigation setting for specific high-risk assets.

## Mechanism
If an asset is marked as "Siloed":
*   Users who borrow this asset **cannot borrow any other asset** in the same wallet.
*   Example: If `TOKEN_X` is Siloed, and you borrow `TOKEN_X`, you cannot also borrow `USDC` or `ETH` in that position.

## Purpose
This prevents "contagion" from a high-risk asset affecting the solvency of other pools. If `TOKEN_X` exploits a vulnerability in its own contract to manipulate its price, the attacker cannot use that manipulated value to drain unrelated blue-chip assets from the protocol.

This is distinct from **Isolation Mode**:
*   **Isolation Mode:** Restricts what you can *supply* as collateral (and limits you to borrowing stablecoins).
*   **Siloed Borrowing:** Restricts what you can *borrow* (preventing you from borrowing anything else).
