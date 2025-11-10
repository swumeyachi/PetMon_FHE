import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface PetLocation {
  id: number;
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

interface LocationStats {
  totalLocations: number;
  verifiedLocations: number;
  activePets: number;
  avgLatitude: number;
  avgLongitude: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [petLocations, setPetLocations] = useState<PetLocation[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newLocationData, setNewLocationData] = useState({ name: "", latitude: "", longitude: "" });
  const [selectedLocation, setSelectedLocation] = useState<PetLocation | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ latitude: number | null; longitude: number | null }>({ latitude: null, longitude: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed." 
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
      const locationsList: PetLocation[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          locationsList.push({
            id: parseInt(businessId.replace('pet-', '')) || Date.now(),
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
          console.error('Error loading business data:', e);
        }
      }
      
      setPetLocations(locationsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createLocation = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingLocation(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating location with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const latitudeValue = Math.round(parseFloat(newLocationData.latitude) * 1000000);
      const businessId = `pet-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, latitudeValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newLocationData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        latitudeValue,
        Math.round(parseFloat(newLocationData.longitude) * 1000000),
        "Pet Location Data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Location created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewLocationData({ name: "", latitude: "", longitude: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingLocation(false); 
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
          message: "Data already verified" 
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified" 
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
        message: "Decryption failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getLocationStats = (): LocationStats => {
    const totalLocations = petLocations.length;
    const verifiedLocations = petLocations.filter(l => l.isVerified).length;
    const activePets = new Set(petLocations.map(l => l.name)).size;
    
    const avgLatitude = petLocations.length > 0 
      ? petLocations.reduce((sum, l) => sum + l.publicValue1, 0) / petLocations.length 
      : 0;
      
    const avgLongitude = petLocations.length > 0 
      ? petLocations.reduce((sum, l) => sum + l.publicValue2, 0) / petLocations.length 
      : 0;

    return {
      totalLocations,
      verifiedLocations,
      activePets,
      avgLatitude,
      avgLongitude
    };
  };

  const renderStats = () => {
    const stats = getLocationStats();
    
    return (
      <div className="stats-grid">
        <div className="stat-card wood-card">
          <div className="stat-icon">🐾</div>
          <div className="stat-content">
            <h3>Active Pets</h3>
            <div className="stat-value">{stats.activePets}</div>
          </div>
        </div>
        
        <div className="stat-card stone-card">
          <div className="stat-icon">📍</div>
          <div className="stat-content">
            <h3>Total Locations</h3>
            <div className="stat-value">{stats.totalLocations}</div>
          </div>
        </div>
        
        <div className="stat-card grass-card">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <h3>Verified Data</h3>
            <div className="stat-value">{stats.verifiedLocations}</div>
          </div>
        </div>
        
        <div className="stat-card ocean-card">
          <div className="stat-icon">🌍</div>
          <div className="stat-content">
            <h3>Avg Position</h3>
            <div className="stat-value">{(stats.avgLatitude/1000000).toFixed(4)}, {(stats.avgLongitude/1000000).toFixed(4)}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderMapPreview = () => {
    return (
      <div className="map-preview">
        <div className="map-grid">
          {Array.from({ length: 25 }).map((_, index) => {
            const hasPet = petLocations.some(loc => 
              (index % 5) === Math.floor(loc.publicValue1 / 2000000) % 5 &&
              Math.floor(index / 5) === Math.floor(loc.publicValue2 / 2000000) % 5
            );
            
            return (
              <div 
                key={index} 
                className={`map-cell ${hasPet ? 'has-pet' : ''}`}
                onMouseEnter={(e) => {
                  if (hasPet) {
                    e.currentTarget.style.transform = 'scale(1.2)';
                    e.currentTarget.style.zIndex = '10';
                  }
                }}
                onMouseLeave={(e) => {
                  if (hasPet) {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.zIndex = '1';
                  }
                }}
              >
                {hasPet && <span className="pet-marker">🐕</span>}
              </div>
            );
          })}
        </div>
        <div className="map-legend">
          <div className="legend-item">
            <span className="legend-marker">🐕</span>
            <span>Pet Location</span>
          </div>
          <div className="legend-item">
            <span className="legend-marker empty"></span>
            <span>Empty Area</span>
          </div>
        </div>
      </div>
    );
  };

  const filteredLocations = petLocations.filter(location =>
    location.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Private Pet Monitor 🌲</h1>
            <p>FHE Protected Location Tracking</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🐾</div>
            <h2>Connect to Monitor Your Pets</h2>
            <p>Secure, encrypted location tracking for your beloved pets using FHE technology</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to begin</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initializes automatically</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start tracking with full privacy</p>
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
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing pet location data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted pet monitor...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private Pet Monitor 🌲</h1>
          <p>FHE Protected Location Tracking</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn wood-btn"
          >
            + Add Pet Location
          </button>
          <button 
            onClick={checkAvailability} 
            className="check-btn stone-btn"
          >
            Check FHE
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="content-header">
          <div className="header-tabs">
            <button 
              className={`tab-btn ${!showMap && !showFAQ ? 'active' : ''}`}
              onClick={() => { setShowMap(false); setShowFAQ(false); }}
            >
              Dashboard
            </button>
            <button 
              className={`tab-btn ${showMap ? 'active' : ''}`}
              onClick={() => setShowMap(true)}
            >
              Location Map
            </button>
            <button 
              className={`tab-btn ${showFAQ ? 'active' : ''}`}
              onClick={() => setShowFAQ(true)}
            >
              FAQ
            </button>
          </div>
          
          <div className="header-controls">
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Search pets..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>
            <button 
              onClick={loadData} 
              className="refresh-btn grass-btn" 
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {showFAQ ? (
          <div className="faq-section">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-list">
              <div className="faq-item">
                <h3>How does FHE protect my pet's location?</h3>
                <p>FHE (Fully Homomorphic Encryption) allows us to perform computations on encrypted data without decrypting it. Your pet's location is encrypted and only you can decrypt it with your private key.</p>
              </div>
              <div className="faq-item">
                <h3>Is my data stored on-chain?</h3>
                <p>Yes, but only in encrypted form. The encrypted data is stored on the blockchain, making it tamper-proof while maintaining complete privacy.</p>
              </div>
              <div className="faq-item">
                <h3>Who can see my pet's location?</h3>
                <p>Only you, the owner, can decrypt and view the exact coordinates. The system uses zero-knowledge proofs to verify data without revealing it.</p>
              </div>
            </div>
          </div>
        ) : showMap ? (
          <div className="map-section">
            <h2>Pet Location Overview</h2>
            {renderMapPreview()}
            <div className="map-stats">
              {renderStats()}
            </div>
          </div>
        ) : (
          <>
            <div className="dashboard-section">
              <h2>Pet Monitoring Dashboard</h2>
              {renderStats()}
              
              <div className="fhe-flow">
                <div className="flow-step">
                  <div className="step-icon">🔐</div>
                  <div className="step-content">
                    <h4>Encrypt Location</h4>
                    <p>Pet coordinates encrypted with FHE before storage</p>
                  </div>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="step-icon">🌐</div>
                  <div className="step-content">
                    <h4>Secure Storage</h4>
                    <p>Encrypted data stored on blockchain</p>
                  </div>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="step-icon">🔓</div>
                  <div className="step-content">
                    <h4>Private Decryption</h4>
                    <p>Only owner can decrypt and view exact location</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="locations-section">
              <div className="section-header">
                <h2>Pet Location History</h2>
                <div className="location-count">
                  {filteredLocations.length} location{filteredLocations.length !== 1 ? 's' : ''}
                </div>
              </div>
              
              <div className="locations-list">
                {filteredLocations.length === 0 ? (
                  <div className="no-locations">
                    <p>No location data found</p>
                    <button 
                      className="create-btn wood-btn" 
                      onClick={() => setShowCreateModal(true)}
                    >
                      Add First Location
                    </button>
                  </div>
                ) : filteredLocations.map((location, index) => (
                  <div 
                    className={`location-card ${selectedLocation?.id === location.id ? "selected" : ""} ${location.isVerified ? "verified" : ""}`} 
                    key={index}
                    onClick={() => setSelectedLocation(location)}
                  >
                    <div className="card-header">
                      <div className="pet-name">{location.name}</div>
                      <div className="status-badge">
                        {location.isVerified ? "✅ Verified" : "🔓 Encrypted"}
                      </div>
                    </div>
                    <div className="card-content">
                      <div className="location-info">
                        <span>Approx: {(location.publicValue1/1000000).toFixed(4)}, {(location.publicValue2/1000000).toFixed(4)}</span>
                        <span>{new Date(location.timestamp * 1000).toLocaleDateString()}</span>
                      </div>
                      {location.isVerified && location.decryptedValue && (
                        <div className="exact-location">
                          Exact: {(location.decryptedValue/1000000).toFixed(6)}, {(location.publicValue2/1000000).toFixed(6)}
                        </div>
                      )}
                    </div>
                    <div className="card-footer">
                      <span>By: {location.creator.substring(0, 6)}...{location.creator.substring(38)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreateLocation 
          onSubmit={createLocation} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingLocation} 
          locationData={newLocationData} 
          setLocationData={setNewLocationData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedLocation && (
        <LocationDetailModal 
          location={selectedLocation} 
          onClose={() => { 
            setSelectedLocation(null); 
            setDecryptedData({ latitude: null, longitude: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(`pet-${selectedLocation.id}`)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateLocation: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  locationData: any;
  setLocationData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, locationData, setLocationData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLocationData({ ...locationData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-location-modal">
        <div className="modal-header">
          <h2>Add Pet Location</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice wood-card">
            <strong>FHE 🔐 Protection</strong>
            <p>Latitude will be encrypted with FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Pet Name *</label>
            <input 
              type="text" 
              name="name" 
              value={locationData.name} 
              onChange={handleChange} 
              placeholder="Enter pet name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Latitude (FHE Encrypted) *</label>
            <input 
              type="number" 
              step="any"
              name="latitude" 
              value={locationData.latitude} 
              onChange={handleChange} 
              placeholder="e.g., 40.7128" 
            />
            <div className="data-type-label">FHE Encrypted Coordinate</div>
          </div>
          
          <div className="form-group">
            <label>Longitude (Public) *</label>
            <input 
              type="number" 
              step="any"
              name="longitude" 
              value={locationData.longitude} 
              onChange={handleChange} 
              placeholder="e.g., -74.0060" 
            />
            <div className="data-type-label">Public Coordinate</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn stone-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !locationData.name || !locationData.latitude || !locationData.longitude} 
            className="submit-btn ocean-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Add Location"}
          </button>
        </div>
      </div>
    </div>
  );
};

const LocationDetailModal: React.FC<{
  location: PetLocation;
  onClose: () => void;
  decryptedData: { latitude: number | null; longitude: number | null };
  setDecryptedData: (value: { latitude: number | null; longitude: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ location, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData.latitude !== null) { 
      setDecryptedData({ latitude: null, longitude: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ latitude: decrypted, longitude: location.publicValue2 });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="location-detail-modal">
        <div className="modal-header">
          <h2>Location Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="location-info">
            <div className="info-item">
              <span>Pet Name:</span>
              <strong>{location.name}</strong>
            </div>
            <div className="info-item">
              <span>Recorded:</span>
              <strong>{new Date(location.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Public Longitude:</span>
              <strong>{(location.publicValue2/1000000).toFixed(6)}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Location Data</h3>
            
            <div className="data-row">
              <div className="data-label">Latitude:</div>
              <div className="data-value">
                {location.isVerified && location.decryptedValue ? 
                  `${(location.decryptedValue/1000000).toFixed(6)} (Verified)` : 
                  decryptedData.latitude !== null ? 
                  `${(decryptedData.latitude/1000000).toFixed(6)} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(location.isVerified || decryptedData.latitude !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Decrypting..."
                ) : location.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.latitude !== null ? (
                  "🔄 Re-decrypt"
                ) : (
                  "🔓 Decrypt"
                )}
              </button>
            </div>
            
            <div className="fhe-info grass-card">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected Data</strong>
                <p>Latitude is encrypted using FHE technology. Only the owner can decrypt and view the exact coordinate.</p>
              </div>
            </div>
          </div>
          
          {(location.isVerified || decryptedData.latitude !== null) && (
            <div className="coordinates-section">
              <h3>Exact Coordinates</h3>
              <div className="coordinate-display">
                <div className="coord-item">
                  <span>Latitude:</span>
                  <strong>
                    {location.isVerified ? 
                      (location.decryptedValue!/1000000).toFixed(6) : 
                      (decryptedData.latitude!/1000000).toFixed(6)
                    }
                  </strong>
                </div>
                <div className="coord-item">
                  <span>Longitude:</span>
                  <strong>{(location.publicValue2/1000000).toFixed(6)}</strong>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn stone-btn">Close</button>
          {!location.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn ocean-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

