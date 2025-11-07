pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PetMon_FHE is ZamaEthereumConfig {
    
    struct PetData {
        string petId;                    
        euint32 encryptedLocation;        
        uint256 timestamp;                
        string status;                    
        address owner;                    
        uint32 decryptedLocation;         
        bool isDecrypted;                 
    }
    
    mapping(string => PetData) public petRecords;
    string[] public petIds;
    
    event PetRegistered(string indexed petId, address indexed owner);
    event LocationDecrypted(string indexed petId, uint32 decryptedLocation);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function registerPet(
        string calldata petId,
        externalEuint32 encryptedLocation,
        bytes calldata inputProof,
        string calldata status
    ) external {
        require(bytes(petRecords[petId].petId).length == 0, "Pet already registered");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedLocation, inputProof)), "Invalid encrypted location");
        
        petRecords[petId] = PetData({
            petId: petId,
            encryptedLocation: FHE.fromExternal(encryptedLocation, inputProof),
            timestamp: block.timestamp,
            status: status,
            owner: msg.sender,
            decryptedLocation: 0,
            isDecrypted: false
        });
        
        FHE.allowThis(petRecords[petId].encryptedLocation);
        FHE.makePubliclyDecryptable(petRecords[petId].encryptedLocation);
        
        petIds.push(petId);
        
        emit PetRegistered(petId, msg.sender);
    }
    
    function decryptLocation(
        string calldata petId, 
        bytes memory abiEncodedClearLocation,
        bytes memory decryptionProof
    ) external {
        require(bytes(petRecords[petId].petId).length > 0, "Pet not registered");
        require(!petRecords[petId].isDecrypted, "Location already decrypted");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(petRecords[petId].encryptedLocation);
        
        FHE.checkSignatures(cts, abiEncodedClearLocation, decryptionProof);
        
        uint32 decodedLocation = abi.decode(abiEncodedClearLocation, (uint32));
        
        petRecords[petId].decryptedLocation = decodedLocation;
        petRecords[petId].isDecrypted = true;
        
        emit LocationDecrypted(petId, decodedLocation);
    }
    
    function getEncryptedLocation(string calldata petId) external view returns (euint32) {
        require(bytes(petRecords[petId].petId).length > 0, "Pet not registered");
        return petRecords[petId].encryptedLocation;
    }
    
    function getPetData(string calldata petId) external view returns (
        string memory petIdValue,
        uint256 timestamp,
        string memory status,
        address owner,
        bool isDecrypted,
        uint32 decryptedLocation
    ) {
        require(bytes(petRecords[petId].petId).length > 0, "Pet not registered");
        PetData storage data = petRecords[petId];
        
        return (
            data.petId,
            data.timestamp,
            data.status,
            data.owner,
            data.isDecrypted,
            data.decryptedLocation
        );
    }
    
    function getAllPetIds() external view returns (string[] memory) {
        return petIds;
    }
    
    function serviceAvailable() public pure returns (bool) {
        return true;
    }
}

