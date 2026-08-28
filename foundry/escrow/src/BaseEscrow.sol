// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal, immutable, single-asset escrow. No admin, upgrade, or call surface.
abstract contract BaseEscrow {
    string public constant DOMAIN_NAME = "Prism Base Escrow";
    string public constant DOMAIN_VERSION = "1";
    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant FUND_TYPEHASH = keccak256(
        "FundingApproval(bytes32 claimId,address payer,address refundDestination,address asset,uint256 amount,uint256 expiry,bytes32 commitment,uint256 nonce,bytes32 action)"
    );
    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "ClaimAuthorization(bytes32 claimId,address payer,address refundDestination,address asset,uint256 amount,uint256 expiry,bytes32 commitment,address recipient,uint256 nonce,bytes32 action)"
    );
    bytes32 public constant FUND_ACTION = keccak256("FUND");
    bytes32 public constant CLAIM_ACTION = keccak256("CLAIM");

    enum State {
        Unfunded,
        Funded,
        Claimed,
        Refunded
    }

    struct Terms {
        address payer;
        address refundDestination;
        bytes32 claimId;
        bytes32 commitment;
        uint256 amount;
        uint256 expiry;
        uint256 nonce;
        State state;
    }
    mapping(bytes32 => Terms) private _terms;
    mapping(bytes32 => bool) private _commitmentExists;
    mapping(bytes32 => bool) public consumedCommitment;
    mapping(bytes32 => bool) public consumedFundingDigest;
    uint256 private _guard;

    error Exists();
    error Missing();
    error WrongState();
    error ZeroAddress();
    error ZeroValue();
    error Expired();
    error NotExpired();
    error NotPayer();
    error BadSignature();
    error Replay();
    error TransferFailed();
    error WrongValue();
    error TokenBalanceChanged();
    event EscrowCreated(
        bytes32 indexed claimId,
        address indexed payer,
        address indexed refundDestination,
        address asset,
        uint256 amount,
        uint256 expiry,
        bytes32 commitment,
        uint256 nonce
    );
    event FundingAccepted(
        bytes32 indexed claimId,
        address indexed payer,
        address indexed funder,
        uint256 amount,
        bytes32 authorizationDigest
    );
    event ExpiryRecognized(bytes32 indexed claimId, uint256 expiry);
    event ClaimAccepted(
        bytes32 indexed claimId,
        address indexed recipient,
        bytes32 indexed commitment,
        uint256 amount,
        bytes32 authorizationDigest
    );
    event RefundAccepted(bytes32 indexed claimId, address indexed refundDestination, uint256 amount);

    modifier nonReentrant() {
        if (_guard != 0) revert Replay();
        _guard = 1;
        _;
        _guard = 0;
    }

    function asset() public view virtual returns (address);
    function _fund(address payer, uint256 amount) internal virtual;
    function _payout(address to, uint256 amount) internal virtual;

    constructor() {
        _guard = 0;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(DOMAIN_NAME)),
                keccak256(bytes(DOMAIN_VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    function terms(bytes32 id) external view returns (Terms memory) {
        return _terms[id];
    }

    function exists(bytes32 id) external view returns (bool) {
        return _terms[id].payer != address(0);
    }

    function fundAuthorizationDigest(bytes32 id) public view returns (bytes32) {
        Terms memory t = _terms[id];
        return _hash(
            keccak256(
                abi.encode(
                    FUND_TYPEHASH,
                    id,
                    t.payer,
                    t.refundDestination,
                    asset(),
                    t.amount,
                    t.expiry,
                    t.commitment,
                    t.nonce,
                    FUND_ACTION
                )
            )
        );
    }

    function claimAuthorizationDigest(bytes32 id, address recipient) public view returns (bytes32) {
        Terms memory t = _terms[id];
        return _hash(
            keccak256(
                abi.encode(
                    CLAIM_TYPEHASH,
                    id,
                    t.payer,
                    t.refundDestination,
                    asset(),
                    t.amount,
                    t.expiry,
                    t.commitment,
                    recipient,
                    t.nonce,
                    CLAIM_ACTION
                )
            )
        );
    }

    function _hash(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function createTerms(
        bytes32 id,
        address refundDestination,
        bytes32 commitment,
        uint256 amount,
        uint256 expiry,
        uint256 nonce
    ) external {
        if (_terms[id].payer != address(0) || _commitmentExists[commitment]) revert Exists();
        if (refundDestination == address(0)) revert ZeroAddress();
        if (amount == 0 || commitment == bytes32(0)) revert ZeroValue();
        if (expiry <= block.timestamp) revert Expired();
        _terms[id] = Terms(msg.sender, refundDestination, id, commitment, amount, expiry, nonce, State.Unfunded);
        _commitmentExists[commitment] = true;
        emit EscrowCreated(id, msg.sender, refundDestination, asset(), amount, expiry, commitment, nonce);
    }

    function fund(bytes32 id, bytes calldata payerApproval) external payable nonReentrant {
        Terms storage t = _terms[id];
        if (t.payer == address(0)) revert Missing();
        if (t.state != State.Unfunded) revert WrongState();
        bytes32 digest = fundAuthorizationDigest(id);
        if (consumedFundingDigest[digest]) revert Replay();
        if (!_valid(t.payer, digest, payerApproval)) revert BadSignature();
        consumedFundingDigest[digest] = true;
        _fund(t.payer, t.amount);
        t.state = State.Funded;
        emit FundingAccepted(id, t.payer, msg.sender, t.amount, digest);
    }

    function claim(bytes32 id, address recipient, bytes calldata authorization) external nonReentrant {
        Terms storage t = _terms[id];
        if (t.payer == address(0)) revert Missing();
        if (t.state != State.Funded) revert WrongState();
        if (block.timestamp >= t.expiry) revert Expired();
        if (recipient == address(0)) revert ZeroAddress();
        if (consumedCommitment[t.commitment]) revert Replay();
        bytes32 digest = claimAuthorizationDigest(id, recipient);
        if (!_valid(recipient, digest, authorization)) revert BadSignature();
        _payout(recipient, t.amount);
        consumedCommitment[t.commitment] = true;
        t.state = State.Claimed;
        emit ClaimAccepted(id, recipient, t.commitment, t.amount, digest);
    }

    function refund(bytes32 id) external nonReentrant {
        Terms storage t = _terms[id];
        if (t.payer == address(0)) revert Missing();
        if (t.state != State.Funded) revert WrongState();
        if (msg.sender != t.refundDestination) revert NotPayer();
        if (block.timestamp < t.expiry) revert NotExpired();
        _payout(t.refundDestination, t.amount);
        t.state = State.Refunded;
        emit ExpiryRecognized(id, t.expiry);
        emit RefundAccepted(id, t.refundDestination, t.amount);
    }

    function _valid(address signer, bytes32 digest, bytes calldata sig) internal pure returns (bool) {
        if (sig.length != 65) return false;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return false;
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) return false;
        return ecrecover(digest, v, r, s) == signer;
    }

    receive() external payable {
        revert();
    }
}

contract EthEscrow is BaseEscrow {
    function asset() public pure override returns (address) {
        return address(0);
    }

    function _fund(address, uint256 amount) internal override {
        if (msg.value != amount) revert WrongValue();
    }

    function _payout(address to, uint256 amount) internal override {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}

contract ERC20Escrow is BaseEscrow {
    address public immutable token;

    constructor(address token_) {
        if (token_ == address(0)) revert ZeroAddress();
        token = token_;
    }

    function asset() public view override returns (address) {
        return token;
    }

    /// @dev Only standard, non-fee, non-rebasing ERC-20s are supported.
    /// Both funding and payout must deliver exactly `amount`; all other token
    /// semantics are rejected rather than silently underpaying a beneficiary.
    function _fund(address payer, uint256 amount) internal override {
        if (msg.value != 0) revert WrongValue();
        uint256 beforeBal = IERC20Minimal(token).balanceOf(address(this));
        if (!IERC20Minimal(token).transferFrom(payer, address(this), amount)) revert TransferFailed();
        if (IERC20Minimal(token).balanceOf(address(this)) != beforeBal + amount) revert TokenBalanceChanged();
    }

    function _payout(address to, uint256 amount) internal override {
        uint256 beforeEscrow = IERC20Minimal(token).balanceOf(address(this));
        uint256 beforeRecipient = IERC20Minimal(token).balanceOf(to);
        if (!IERC20Minimal(token).transfer(to, amount)) revert TransferFailed();
        uint256 afterEscrow = IERC20Minimal(token).balanceOf(address(this));
        uint256 afterRecipient = IERC20Minimal(token).balanceOf(to);
        if (afterEscrow + amount != beforeEscrow || afterRecipient != beforeRecipient + amount) {
            revert TokenBalanceChanged();
        }
    }
}

interface IERC20Minimal {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}
