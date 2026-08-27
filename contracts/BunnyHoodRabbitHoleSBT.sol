// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

/// @title Bunny Hood Rabbit Hole SBT
/// @notice A permanently non-transferable ERC-721 identity token implementing EIP-5192.
/// @dev Approval, transfer, and burn paths intentionally do not exist or always revert.
contract BunnyHoodRabbitHoleSBT {
    error AlreadyMinted(bytes32 claimKey);
    error AlreadyOwnsSoulboundToken(address account);
    error InvalidClaimKey();
    error InvalidOwner();
    error InvalidReceiver();
    error NonexistentToken(uint256 tokenId);
    error NotMinter();
    error NotOwner();
    error Soulbound();

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Locked(uint256 tokenId);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MinterUpdated(address indexed previousMinter, address indexed newMinter);
    event SoulboundMinted(
        address indexed recipient,
        uint256 indexed tokenId,
        bytes32 indexed claimKey,
        string tokenUri
    );

    string public name;
    string public symbol;
    address public owner;
    address public minter;

    uint256 private _nextTokenId = 1;
    mapping(uint256 tokenId => address tokenOwner) private _owners;
    mapping(address tokenOwner => uint256 balance) private _balances;
    mapping(uint256 tokenId => string uri) private _tokenUris;
    mapping(bytes32 claimKey => uint256 tokenId) private _claimTokens;
    mapping(address tokenOwner => uint256 tokenId) private _ownerTokens;

    constructor(
        string memory collectionName,
        string memory collectionSymbol,
        address initialOwner,
        address initialMinter
    ) {
        if (initialOwner == address(0) || initialMinter == address(0)) revert InvalidOwner();
        name = collectionName;
        symbol = collectionSymbol;
        owner = initialOwner;
        minter = initialMinter;
        emit OwnershipTransferred(address(0), initialOwner);
        emit MinterUpdated(address(0), initialMinter);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter();
        _;
    }

    function mint(
        address recipient,
        string calldata uri,
        bytes32 claimKey
    ) external onlyMinter returns (uint256 tokenId) {
        if (recipient == address(0)) revert InvalidReceiver();
        if (claimKey == bytes32(0)) revert InvalidClaimKey();
        if (_claimTokens[claimKey] != 0) revert AlreadyMinted(claimKey);
        if (_balances[recipient] != 0) revert AlreadyOwnsSoulboundToken(recipient);

        tokenId = _nextTokenId++;
        _owners[tokenId] = recipient;
        _balances[recipient] = 1;
        _ownerTokens[recipient] = tokenId;
        _claimTokens[claimKey] = tokenId;
        _tokenUris[tokenId] = uri;

        emit Transfer(address(0), recipient, tokenId);
        emit Locked(tokenId);
        emit SoulboundMinted(recipient, tokenId, claimKey, uri);

        if (recipient.code.length != 0) {
            try IERC721Receiver(recipient).onERC721Received(
                msg.sender,
                address(0),
                tokenId,
                ""
            ) returns (bytes4 response) {
                if (response != IERC721Receiver.onERC721Received.selector) revert InvalidReceiver();
            } catch {
                revert InvalidReceiver();
            }
        }
    }

    function balanceOf(address account) external view returns (uint256) {
        if (account == address(0)) revert InvalidOwner();
        return _balances[account];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        if (tokenOwner == address(0)) revert NonexistentToken(tokenId);
        return tokenOwner;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        return _tokenUris[tokenId];
    }

    function tokenOfClaim(bytes32 claimKey) external view returns (uint256) {
        return _claimTokens[claimKey];
    }

    function tokenOfOwner(address account) external view returns (uint256) {
        return _ownerTokens[account];
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function locked(uint256 tokenId) external view returns (bool) {
        ownerOf(tokenId);
        return true;
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function approve(address, uint256) external pure {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert Soulbound();
    }

    function setMinter(address nextMinter) external onlyOwner {
        if (nextMinter == address(0)) revert InvalidOwner();
        address previousMinter = minter;
        minter = nextMinter;
        emit MinterUpdated(previousMinter, nextMinter);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert InvalidOwner();
        address previousOwner = owner;
        owner = nextOwner;
        emit OwnershipTransferred(previousOwner, nextOwner);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f // ERC-721 metadata
            || interfaceId == 0xb45a3c0e; // EIP-5192 minimal soulbound NFT
    }
}
