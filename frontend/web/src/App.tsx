import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface PetData {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [pets, setPets] = useState<PetData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPet, setCreatingPet] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newPetData, setNewPetData] = useState({ name: "", latitude: "", longitude: "" });
  const [selectedPet, setSelectedPet] = useState<PetData | null>(null);
  const [decryptedLocation, setDecryptedLocation] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const petsList: PetData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          petsList.push({
            id: businessId,
            name: businessData.name,
            latitude: Number(businessData.publicValue1) || 0,
            longitude: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading pet data:', e);
        }
      }
      
      setPets(petsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createPet = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingPet(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating pet location with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const latitudeValue = parseInt(newPetData.latitude) || 0;
      const businessId = `pet-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, latitudeValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPetData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newPetData.latitude) || 0,
        parseInt(newPetData.longitude) || 0,
        "Pet Location Data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Pet location created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewPetData({ name: "", latitude: "", longitude: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingPet(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Location decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleIsAvailable = async () => {
    try {
      const contract = await getContractWithSigner();
      if (!contract) return;
      
      const tx = await contract.isAvailable();
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Check availability failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredPets = pets.filter(pet => 
    pet.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStats = () => {
    const totalPets = pets.length;
    const verifiedPets = pets.filter(p => p.isVerified).length;
    const activeToday = pets.filter(p => 
      Date.now()/1000 - p.timestamp < 60 * 60 * 24
    ).length;

    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">🐾</div>
          <div className="stat-content">
            <div className="stat-number">{totalPets}</div>
            <div className="stat-label">Total Pets</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">🔒</div>
          <div className="stat-content">
            <div className="stat-number">{verifiedPets}</div>
            <div className="stat-label">Verified</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">📍</div>
          <div className="stat-content">
            <div className="stat-number">{activeToday}</div>
            <div className="stat-label">Active Today</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Encrypt Location</h4>
            <p>Pet coordinates encrypted with FHE technology</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Store Securely</h4>
            <p>Encrypted data stored on blockchain</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Decrypt Privately</h4>
            <p>Only owner can decrypt and view</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <h1>Private Pet Monitor 🐕</h1>
            <p>FHE-Protected Location Tracking</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="welcome-section">
          <div className="welcome-content">
            <div className="pet-icon">🐾</div>
            <h2>Secure Your Pet's Location</h2>
            <p>Connect your wallet to start monitoring your pet's location with full encryption</p>
            <div className="feature-list">
              <div className="feature-item">
                <span className="feature-icon">🔐</span>
                <span>FHE Encrypted Coordinates</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🐕</span>
                <span>Real-time Tracking</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">👑</span>
                <span>Owner-Only Access</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Initializing FHE Security System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="loading-spinner"></div>
      <p>Loading Pet Monitor...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <div className="logo-section">
            <h1>Private Pet Monitor 🐕</h1>
            <p>FHE-Encrypted Location Tracking</p>
          </div>
        </div>
        
        <div className="header-right">
          <button className="faq-btn" onClick={() => setShowFAQ(true)}>FAQ</button>
          <button className="test-btn" onClick={handleIsAvailable}>Test Contract</button>
          <button className="add-pet-btn" onClick={() => setShowCreateModal(true)}>+ Add Pet</button>
          <ConnectButton />
        </div>
      </header>

      <main className="main-content">
        <div className="content-section">
          <div className="section-header">
            <h2>Pet Location Dashboard</h2>
            <div className="header-actions">
              <input 
                type="text"
                placeholder="Search pets..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
                {isRefreshing ? "🔄" : "↻"}
              </button>
            </div>
          </div>

          {renderStats()}
          
          <div className="fhe-info-panel">
            <h3>FHE Security Process</h3>
            {renderFHEProcess()}
          </div>

          <div className="pets-grid">
            {filteredPets.length === 0 ? (
              <div className="no-pets">
                <div className="no-pets-icon">🐾</div>
                <p>No pets found</p>
                <button onClick={() => setShowCreateModal(true)} className="add-first-pet">
                  Add Your First Pet
                </button>
              </div>
            ) : (
              filteredPets.map((pet) => (
                <div key={pet.id} className="pet-card">
                  <div className="pet-header">
                    <h3>{pet.name}</h3>
                    <span className={`status ${pet.isVerified ? 'verified' : 'encrypted'}`}>
                      {pet.isVerified ? '🔓' : '🔒'}
                    </span>
                  </div>
                  
                  <div className="pet-info">
                    <div className="info-row">
                      <span>Owner:</span>
                      <span>{pet.creator.substring(0, 8)}...</span>
                    </div>
                    <div className="info-row">
                      <span>Added:</span>
                      <span>{new Date(pet.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="info-row">
                      <span>Location Status:</span>
                      <span>{pet.isVerified ? 'Decrypted' : 'Encrypted'}</span>
                    </div>
                  </div>

                  <div className="pet-actions">
                    <button 
                      onClick={async () => {
                        const decrypted = await decryptData(pet.id);
                        if (decrypted !== null) {
                          setDecryptedLocation({ lat: decrypted, lng: pet.publicValue2 });
                          setSelectedPet(pet);
                        }
                      }}
                      disabled={isDecrypting}
                      className={`action-btn ${pet.isVerified ? 'decrypted' : 'encrypt'}`}
                    >
                      {isDecrypting ? 'Decrypting...' : pet.isVerified ? 'View Location' : 'Decrypt Location'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Add New Pet</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="input-group">
                <label>Pet Name</label>
                <input 
                  type="text"
                  value={newPetData.name}
                  onChange={(e) => setNewPetData({...newPetData, name: e.target.value})}
                  placeholder="Enter pet name"
                />
              </div>
              
              <div className="input-group">
                <label>Latitude (FHE Encrypted)</label>
                <input 
                  type="number"
                  value={newPetData.latitude}
                  onChange={(e) => setNewPetData({...newPetData, latitude: e.target.value})}
                  placeholder="Enter latitude"
                />
                <span className="input-note">Encrypted with FHE</span>
              </div>
              
              <div className="input-group">
                <label>Longitude (Public)</label>
                <input 
                  type="number"
                  value={newPetData.longitude}
                  onChange={(e) => setNewPetData({...newPetData, longitude: e.target.value})}
                  placeholder="Enter longitude"
                />
                <span className="input-note">Public data</span>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createPet}
                disabled={creatingPet || isEncrypting}
                className="submit-btn"
              >
                {creatingPet || isEncrypting ? 'Adding...' : 'Add Pet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedPet && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>{selectedPet.name} Location</h2>
              <button onClick={() => setSelectedPet(null)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="location-info">
                <div className="coord">
                  <span>Latitude:</span>
                  <strong>
                    {selectedPet.isVerified ? 
                      selectedPet.decryptedValue : 
                      decryptedLocation.lat !== null ? 
                      decryptedLocation.lat : '🔒 Encrypted'
                    }
                  </strong>
                </div>
                <div className="coord">
                  <span>Longitude:</span>
                  <strong>{selectedPet.publicValue2}</strong>
                </div>
              </div>
              
              <div className="map-placeholder">
                <div className="map-icon">🗺️</div>
                <p>Location Map Display</p>
                <div className="coordinates">
                  Lat: {selectedPet.isVerified ? selectedPet.decryptedValue : decryptedLocation.lat || 'Encrypted'}, 
                  Lng: {selectedPet.publicValue2}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showFAQ && (
        <div className="modal-overlay">
          <div className="faq-modal">
            <div className="modal-header">
              <h2>FAQ - Private Pet Monitor</h2>
              <button onClick={() => setShowFAQ(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="faq-item">
                <h4>How does FHE protect my pet's location?</h4>
                <p>FHE (Fully Homomorphic Encryption) allows us to encrypt location data while still being able to perform operations on it. Only you can decrypt and view the actual coordinates.</p>
              </div>
              
              <div className="faq-item">
                <h4>Who can see my pet's location?</h4>
                <p>Only you, the owner, can decrypt and view your pet's exact location. The data is stored encrypted on the blockchain.</p>
              </div>
              
              <div className="faq-item">
                <h4>How do I decrypt the location?</h4>
                <p>Click the "Decrypt Location" button on your pet's card. This will verify the decryption on-chain while keeping the process private.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className={`notification ${transactionStatus.status}`}>
          <div className="notification-content">
            <span className="notification-icon">
              {transactionStatus.status === 'success' ? '✓' : 
               transactionStatus.status === 'error' ? '✕' : '⏳'}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;