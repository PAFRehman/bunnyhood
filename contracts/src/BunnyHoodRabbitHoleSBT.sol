// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IERC5192 {
    event Locked(uint256 tokenId);

    function locked(uint256 tokenId) external view returns (bool);
}

/// @title Bunny Hood Rabbit Hole SBT
/// @notice A capped, permanently non-transferable ERC-721 credential for Rabbit Hole claims.
contract BunnyHoodRabbitHoleSBT is ERC721URIStorage, Ownable, IERC5192 {
    uint256 public constant MAX_SUPPLY = 100;

    address public minter;
    uint256 public totalSupply;
    mapping(bytes32 claimKey => uint256 tokenId) public claimTokenId;

    error InvalidAddress();
    error InvalidClaim();
    error MinterOnly();
    error SupplyComplete();
    error Soulbound();

    event MinterUpdated(address indexed previousMinter, address indexed newMinter);
    event RabbitClaimed(
        bytes32 indexed claimKey,
        uint256 indexed tokenId,
        address indexed recipient,
        string tokenUri
    );

    constructor(address initialOwner, address initialMinter)
        ERC721("Bunny Hood Rabbit Hole", "BHRH")
        Ownable(initialOwner)
    {
        if (initialOwner == address(0) || initialMinter == address(0)) revert InvalidAddress();
        minter = initialMinter;
        emit MinterUpdated(address(0), initialMinter);
    }

    modifier onlyMinter() {
        if (msg.sender != minter) revert MinterOnly();
        _;
    }

    function setMinter(address newMinter) external onlyOwner {
        if (newMinter == address(0)) revert InvalidAddress();
        address previousMinter = minter;
        minter = newMinter;
        emit MinterUpdated(previousMinter, newMinter);
    }

    function mintClaim(
        address recipient,
        bytes32 claimKey,
        string calldata tokenUri
    ) external onlyMinter returns (uint256 tokenId) {
        if (recipient == address(0)) revert InvalidAddress();
        if (claimKey == bytes32(0) || bytes(tokenUri).length == 0) revert InvalidClaim();
        if (claimTokenId[claimKey] != 0) revert InvalidClaim();
        if (totalSupply >= MAX_SUPPLY) revert SupplyComplete();

        tokenId = totalSupply + 1;
        totalSupply = tokenId;
        claimTokenId[claimKey] = tokenId;
        _safeMint(recipient, tokenId);
        _setTokenURI(tokenId, tokenUri);

        emit Locked(tokenId);
        emit RabbitClaimed(claimKey, tokenId, recipient, tokenUri);
    }

    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function approve(address, uint256) public pure override(ERC721, IERC721) {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override(ERC721, IERC721) {
        revert Soulbound();
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage)
        returns (bool)
    {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }
}
