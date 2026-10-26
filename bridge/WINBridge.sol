// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// Existing BNB WIN is locked/released. No minting or owner withdrawal function.
/// Two of three independent operators attest finalized native withdrawals.
contract WINBridge is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    bytes32 public immutable networkId;
    uint256 public constant feeBps = 50;
    address[3] public operators;
    mapping(bytes32 => bool) public released;
    mapping(address => uint256) public nonces;
    bytes32 private immutable DOMAIN;
    bytes32 private constant WITHDRAWAL = keccak256("Withdrawal(bytes32 id,address recipient,uint256 amount)");
    event Deposited(bytes32 indexed id, bytes32 indexed recipient, address indexed sender, uint256 amount);
    event Released(bytes32 indexed id, address indexed recipient, uint256 amount);
    constructor(address token_, bytes32 networkId_, address[3] memory operators_) {
        require(token_.code.length > 0 && networkId_ != bytes32(0), "configuration");
        token = IERC20(token_); networkId = networkId_;
        for (uint256 i; i < 3; i++) {
            require(operators_[i] != address(0), "operator");
            for (uint256 j; j < i; j++) require(operators_[j] != operators_[i], "duplicate");
            operators[i] = operators_[i];
        }
        DOMAIN = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)"), keccak256("WINBridge"), keccak256("1"), block.chainid, address(this), networkId_));
    }
    function deposit(uint256 amount, bytes32 recipient) external nonReentrant returns (bytes32 id) {
        require(amount > (amount * feeBps + 9999) / 10000 && recipient != bytes32(0), "amount/recipient");
        // Native public wallet addresses are EVM addresses followed by 12 zero bytes.
        require(uint96(uint256(recipient)) == 0, "native address");
        for (uint256 i; i <= 6; i++) require(recipient != bytes32(i << 252), "system recipient");
        id = keccak256(abi.encode(networkId, address(this), msg.sender, nonces[msg.sender]++, recipient, amount));
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        require(token.balanceOf(address(this)) == beforeBalance + amount, "exact WIN required");
        emit Deposited(id, recipient, msg.sender, amount);
    }
    function release(bytes32 id, address recipient, uint256 amount, bytes[2] calldata signatures) external nonReentrant {
        require(id != bytes32(0) && !released[id] && amount > 0 && recipient != address(0) && recipient != address(this) && recipient != address(token), "withdrawal");
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN, keccak256(abi.encode(WITHDRAWAL, id, recipient, amount))));
        address first;
        for (uint256 i; i < 2; i++) {
            address signer = ECDSA.recover(digest, signatures[i]);
            require(signer == operators[0] || signer == operators[1] || signer == operators[2], "signature");
            if (i == 0) first = signer; else require(signer != first, "quorum");
        }
        released[id] = true;
        uint256 beforeBalance = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        require(token.balanceOf(recipient) == beforeBalance + amount, "exact WIN required");
        emit Released(id, recipient, amount);
    }
}
