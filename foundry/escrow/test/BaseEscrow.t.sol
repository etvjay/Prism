// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EthEscrow, ERC20Escrow, BaseEscrow, IERC20Minimal} from "../src/BaseEscrow.sol";

interface Vm {
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function deal(address, uint256) external;
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectEmit(bool, bool, bool, bool) external;
}

contract MockToken is IERC20Minimal {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public fail;
    bool public fee;
    address public callback;
    address public callbackEscrow;
    bytes32 public callbackId;
    bytes public callbackAuth;
    bool public callbackValue;

    function setFee(bool value) external {
        fee = value;
    }

    function setFail(bool value) external {
        fail = value;
    }

    function setCallback(address value, address escrow, bytes32 id, bytes calldata auth) external {
        callback = value;
        callbackEscrow = escrow;
        callbackId = id;
        callbackAuth = auth;
    }

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (fail) return false;
        require(allowance[from][msg.sender] >= amount && balanceOf[from] >= amount);
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        uint256 received = fee ? amount - 1 : amount;
        balanceOf[to] += received;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (fail) return false;
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        uint256 received = fee ? amount - 1 : amount;
        balanceOf[to] += received;
        if (callback != address(0)) {
            (callbackValue,) = callback.call(
                abi.encodeWithSignature("reenter(address,bytes32,bytes)", callbackEscrow, callbackId, callbackAuth)
            );
        }
        return true;
    }
}

contract ReentrantTokenCallback {
    function reenter(address escrow, bytes32 id, bytes calldata auth) external {
        ERC20Escrow(payable(escrow)).claim(id, address(this), auth);
    }
}

contract BaseEscrowTest {
    event FundingAccepted(
        bytes32 indexed claimId,
        address indexed payer,
        address indexed funder,
        uint256 amount,
        bytes32 authorizationDigest
    );
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant payerPk = 0xA11CE;
    uint256 internal constant recipientPk = 0xB0B;
    address internal payer;
    address internal recipient;
    address internal refund;

    function setUp() public {
        payer = vm.addr(payerPk);
        recipient = vm.addr(recipientPk);
        refund = vm.addr(0xC0FFEE);
        vm.deal(payer, 10 ether);
    }

    function sig(bytes32 digest, uint256 pk) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function createEth(EthEscrow escrow, bytes32 id, bytes32 commitment) internal {
        vm.prank(payer);
        escrow.createTerms(id, refund, commitment, 1 ether, block.timestamp + 100, 7);
    }

    function fundEth(EthEscrow escrow, bytes32 id) internal {
        bytes memory approval = sig(escrow.fundAuthorizationDigest(id), payerPk);
        vm.prank(payer);
        escrow.fund{value: 1 ether}(id, approval);
    }

    function createToken(ERC20Escrow escrow, MockToken token, bytes32 id, bytes32 commitment) internal {
        token.mint(payer, 10);
        vm.prank(payer);
        token.approve(address(escrow), 10);
        vm.prank(payer);
        escrow.createTerms(id, refund, commitment, 1, block.timestamp + 100, 7);
    }

    function fundToken(ERC20Escrow escrow, bytes32 id) internal {
        bytes memory approval = sig(escrow.fundAuthorizationDigest(id), payerPk);
        vm.prank(payer);
        escrow.fund(id, approval);
    }

    function testEthHappyClaimAndReads() public {
        EthEscrow escrow = new EthEscrow();
        bytes32 id = keccak256("claim");
        createEth(escrow, id, keccak256("secret"));
        fundEth(escrow, id);
        uint256 beforeBalance = recipient.balance;
        vm.prank(recipient);
        escrow.claim(id, recipient, sig(escrow.claimAuthorizationDigest(id, recipient), recipientPk));
        BaseEscrow.Terms memory terms = escrow.terms(id);
        require(uint256(terms.state) == uint256(BaseEscrow.State.Claimed));
        require(recipient.balance == beforeBalance + 1 ether);
        require(escrow.exists(id));
    }

    function testEthFundRequiresExactValue() public {
        EthEscrow escrow = new EthEscrow();
        bytes32 id = keccak256("wrong-value");
        createEth(escrow, id, keccak256("wrong-value-commitment"));
        bytes memory approval = sig(escrow.fundAuthorizationDigest(id), payerPk);
        vm.prank(payer);
        vm.expectRevert(BaseEscrow.WrongValue.selector);
        escrow.fund{value: 2 ether}(id, approval);
        require(uint256(escrow.terms(id).state) == uint256(BaseEscrow.State.Unfunded));
    }

    function testFundingEventAndReadMatchAcceptedTerms() public {
        EthEscrow escrow = new EthEscrow();
        bytes32 id = keccak256("event");
        bytes32 commitment = keccak256("event-commitment");
        createEth(escrow, id, commitment);
        bytes32 digest = escrow.fundAuthorizationDigest(id);
        bytes memory approval = sig(digest, payerPk);
        vm.expectEmit(true, true, true, true);
        emit FundingAccepted(id, payer, payer, 1 ether, digest);
        vm.prank(payer);
        escrow.fund{value: 1 ether}(id, approval);
        BaseEscrow.Terms memory terms = escrow.terms(id);
        require(terms.claimId == id && terms.commitment == commitment);
        require(uint256(terms.state) == uint256(BaseEscrow.State.Funded));
    }

    function testEthRefundAndFailedPayoutStayNonterminal() public {
        EthEscrow escrow = new EthEscrow();
        bytes32 id = keccak256("refund");
        createEth(escrow, id, keccak256("refund-commitment"));
        fundEth(escrow, id);
        vm.warp(block.timestamp + 100);
        vm.prank(refund);
        escrow.refund(id);
        require(uint256(escrow.terms(id).state) == uint256(BaseEscrow.State.Refunded));
    }

    function testTokenFundRejectsAccidentalEthAndFeeOnTransfer() public {
        MockToken token = new MockToken();
        ERC20Escrow escrow = new ERC20Escrow(address(token));
        bytes32 id = keccak256("token-fund");
        createToken(escrow, token, id, keccak256("token-fund-commitment"));
        bytes memory approval = sig(escrow.fundAuthorizationDigest(id), payerPk);
        vm.prank(payer);
        vm.expectRevert(BaseEscrow.WrongValue.selector);
        escrow.fund{value: 1}(id, approval);
        token.setFee(true);
        vm.prank(payer);
        vm.expectRevert(BaseEscrow.TokenBalanceChanged.selector);
        escrow.fund(id, approval);
        require(uint256(escrow.terms(id).state) == uint256(BaseEscrow.State.Unfunded));
    }

    function testTokenClaimAndRefundRequireExactRecipientAndEscrowDeltas() public {
        MockToken token = new MockToken();
        ERC20Escrow escrow = new ERC20Escrow(address(token));
        bytes32 id = keccak256("token-claim");
        createToken(escrow, token, id, keccak256("token-claim-commitment"));
        fundToken(escrow, id);
        uint256 beforeRecipient = token.balanceOf(recipient);
        vm.prank(recipient);
        escrow.claim(id, recipient, sig(escrow.claimAuthorizationDigest(id, recipient), recipientPk));
        require(token.balanceOf(recipient) == beforeRecipient + 1);
        require(token.balanceOf(address(escrow)) == 0);
        require(uint256(escrow.terms(id).state) == uint256(BaseEscrow.State.Claimed));

        bytes32 refundId = keccak256("token-refund");
        createToken(escrow, token, refundId, keccak256("token-refund-commitment"));
        fundToken(escrow, refundId);
        vm.warp(block.timestamp + 100);
        uint256 beforeRefund = token.balanceOf(refund);
        vm.prank(refund);
        escrow.refund(refundId);
        require(token.balanceOf(refund) == beforeRefund + 1);
        require(uint256(escrow.terms(refundId).state) == uint256(BaseEscrow.State.Refunded));
    }

    function testTokenFeeOnTransferPayoutRevertsBeforeTerminalState() public {
        MockToken token = new MockToken();
        ERC20Escrow escrow = new ERC20Escrow(address(token));
        bytes32 id = keccak256("token-fee-payout");
        createToken(escrow, token, id, keccak256("token-fee-payout-commitment"));
        fundToken(escrow, id);
        token.setFee(true);
        bytes memory authorization = sig(escrow.claimAuthorizationDigest(id, recipient), recipientPk);
        vm.prank(recipient);
        vm.expectRevert(BaseEscrow.TokenBalanceChanged.selector);
        escrow.claim(id, recipient, authorization);
        require(uint256(escrow.terms(id).state) == uint256(BaseEscrow.State.Funded));
        require(!escrow.consumedCommitment(keccak256("token-fee-payout-commitment")));
    }

    function testTokenCallbackCannotReenterAndDoesNotChangeTerminalAccounting() public {
        MockToken token = new MockToken();
        ERC20Escrow escrow = new ERC20Escrow(address(token));
        ReentrantTokenCallback callback = new ReentrantTokenCallback();
        bytes32 id = keccak256("callback");
        createToken(escrow, token, id, keccak256("callback-commitment"));
        fundToken(escrow, id);
        token.setCallback(address(callback), address(escrow), id, "");
        vm.prank(recipient);
        escrow.claim(id, recipient, sig(escrow.claimAuthorizationDigest(id, recipient), recipientPk));
        require(token.balanceOf(recipient) == 1);
        require(uint256(escrow.terms(id).state) == uint256(BaseEscrow.State.Claimed));
    }

    function testDomainBindsChainAndVerifyingContractAndAsset() public {
        EthEscrow first = new EthEscrow();
        EthEscrow second = new EthEscrow();
        bytes32 id = keccak256("domain");
        createEth(first, id, keccak256("domain-commitment"));
        require(first.domainSeparator() != second.domainSeparator());
        require(first.fundAuthorizationDigest(id) != second.fundAuthorizationDigest(id));
        MockToken token = new MockToken();
        ERC20Escrow tokenEscrow = new ERC20Escrow(address(token));
        createToken(tokenEscrow, token, id, keccak256("domain-token-commitment"));
        require(first.fundAuthorizationDigest(id) != tokenEscrow.fundAuthorizationDigest(id));
    }

    function testDuplicateCommitmentAcrossIdsIsRejected() public {
        EthEscrow escrow = new EthEscrow();
        bytes32 commitment = keccak256("duplicate");
        bytes32 first = keccak256("first-id");
        bytes32 second = keccak256("second-id");
        createEth(escrow, first, commitment);
        vm.prank(payer);
        vm.expectRevert(BaseEscrow.Exists.selector);
        escrow.createTerms(second, refund, commitment, 1 ether, block.timestamp + 100, 7);
        fundEth(escrow, first);
        vm.prank(recipient);
        escrow.claim(first, recipient, sig(escrow.claimAuthorizationDigest(first, recipient), recipientPk));
        require(escrow.consumedCommitment(commitment));
    }
}
