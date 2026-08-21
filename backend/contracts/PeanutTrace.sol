pragma solidity ^0.8.20;

contract PeanutTrace {
    struct TraceRecord {
        uint256 blockIndex;
        uint256 timestamp;
        string recordType;
        string batchId;
        string seedBatchId;
        string dataHash;
        string ipfsHash;
        address uploader;
        string uploaderType;
        bytes signature;
    }

    struct BatchInfo {
        string seedBatchId;
        uint256 recordCount;
        uint256 firstBlock;
        uint256 lastBlock;
        bool exists;
    }

    mapping(uint256 => TraceRecord) public traceRecords;
    mapping(string => BatchInfo) public batchInfo;
    mapping(string => uint256[]) public batchBlocks;
    
    uint256 public recordCount;

    event RecordAdded(
        uint256 indexed blockIndex,
        string recordType,
        string batchId,
        string seedBatchId,
        string dataHash
    );

    function addRecord(
        string memory _recordType,
        string memory _batchId,
        string memory _seedBatchId,
        string memory _dataHash,
        string memory _ipfsHash,
        string memory _uploaderType,
        bytes memory _signature
    ) public returns (uint256) {
        recordCount++;
        
        TraceRecord memory record = TraceRecord({
            blockIndex: recordCount,
            timestamp: block.timestamp,
            recordType: _recordType,
            batchId: _batchId,
            seedBatchId: _seedBatchId,
            dataHash: _dataHash,
            ipfsHash: _ipfsHash,
            uploader: msg.sender,
            uploaderType: _uploaderType,
            signature: _signature
        });
        
        traceRecords[recordCount] = record;
        batchBlocks[_seedBatchId].push(recordCount);
        
        if (!batchInfo[_seedBatchId].exists) {
            batchInfo[_seedBatchId] = BatchInfo({
                seedBatchId: _seedBatchId,
                recordCount: 1,
                firstBlock: recordCount,
                lastBlock: recordCount,
                exists: true
            });
        } else {
            batchInfo[_seedBatchId].recordCount++;
            batchInfo[_seedBatchId].lastBlock = recordCount;
        }
        
        emit RecordAdded(recordCount, _recordType, _batchId, _seedBatchId, _dataHash);
        
        return recordCount;
    }

    function getRecord(uint256 _blockIndex) public view returns (TraceRecord memory) {
        return traceRecords[_blockIndex];
    }

    function getBatchInfo(string memory _seedBatchId) public view returns (BatchInfo memory) {
        return batchInfo[_seedBatchId];
    }

    function getBatchBlocks(string memory _seedBatchId) public view returns (uint256[] memory) {
        return batchBlocks[_seedBatchId];
    }
}
