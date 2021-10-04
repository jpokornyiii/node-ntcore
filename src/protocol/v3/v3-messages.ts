import ieee754 from "ieee754";
import { NTEntryFlags, NTEntryValue } from "../nt-entry";
import { checkBufferLength, InvalidEntryValueError, InvalidMessageTypeError, encodeLEB128String, decodeLEB128String, toUnsignedLEB128, InvalidEntryTypeError, fromUnsignedLEB128 } from "../protocol-utils";
import { ByteToV3EntryType, ByteToV3MessageType, CLEAR_ALL_ENTRIES_MAGIC_VALUE, V3EntryFlags, V3EntryType, V3MessageType, V3RPCDefinition as V3RPCDefinition, V3RPCParameter, V3RPCResult } from "./v3-types";

// MESSAGES
export interface V3Message {
    type: V3MessageType;
}

export interface V3KeepAliveMessage extends V3Message {
    type: V3MessageType.KEEP_ALIVE;
}

export interface V3ClientHelloMessage extends V3Message {
    type: V3MessageType.CLIENT_HELLO;
    protocolMajor: number;
    protocolMinor: number;
    clientIdent: string;
}

export interface V3ProtoVersionUnsupportedMessage extends V3Message {
    type: V3MessageType.PROTO_VERSION_UNSUPPORTED;
    serverSupportedProtocolMajor: number;
    serverSupportedProtocolMinor: number;
}

export interface V3ServerHelloCompleteMessage extends V3Message {
    type: V3MessageType.SERVER_HELLO_COMPLETE;
}

export interface V3ServerHelloMessage extends V3Message {
    type: V3MessageType.SERVER_HELLO;
    clientPreviouslySeen: boolean;
    serverIdentity: string;
}

export interface V3ClientHelloCompleteMessage extends V3Message {
    type: V3MessageType.CLIENT_HELLO_COMPLETE;
}

export interface V3EntryAssignmentMessage extends V3Message {
    type: V3MessageType.ENTRY_ASSIGNMENT;
    entryName: string;
    entryType: V3EntryType;
    entryId: number;
    entrySeq: number;
    entryFlags: NTEntryFlags;
    entryValue: NTEntryValue;
}

export interface V3EntryUpdateMessage extends V3Message {
    type: V3MessageType.ENTRY_UPDATE;
    entryType: V3EntryType;
    entryId: number;
    entrySeq: number;
    entryValue: NTEntryValue;
}

export interface V3EntryFlagsUpdateMessage extends V3Message {
    type: V3MessageType.ENTRY_FLAGS_UPDATE;
    entryId: number;
    entryFlags: NTEntryFlags;
}

export interface V3EntryDeleteMessage extends V3Message {
    type: V3MessageType.ENTRY_DELETE;
    entryId: number;
}

export interface V3ClearAllEntriesMessage extends V3Message {
    type: V3MessageType.CLEAR_ALL_ENTRIES;
}

export interface V3RPCExecuteMessage extends V3Message {
    type: V3MessageType.RPC_EXECUTE;
    rpcDefinitionId: number;
    uniqueId: number;
    parameters: V3RPCParameter[];
}

export interface V3RPCResponseMessage extends V3Message {
    type: V3MessageType.RPC_RESPONSE;
    rpcDefinitionId: number;
    uniqueId: number;
    results: V3RPCResult[];
}

// BUFFER MANIPULATION
function checkMessageType(buf: Buffer, offset: number, expectedType: V3MessageType) {
    if (buf[offset] !== expectedType) {
        throw new InvalidMessageTypeError(`Expected type 0x${(expectedType as number).toString(16)} but got 0x${(buf[offset]).toString(16)} instead`)
    }
}

function checkEntryValue(type: V3EntryType, valueObj: NTEntryValue) {
    if (type === V3EntryType.BOOLEAN && valueObj.bool === undefined) {
        throw new InvalidEntryValueError("Expected boolean value");
    }
    else if (type === V3EntryType.DOUBLE && valueObj.double === undefined) {
        throw new InvalidEntryValueError("Expected double value");
    }
    else if (type === V3EntryType.STRING && valueObj.str === undefined) {
        throw new InvalidEntryValueError("Expected string value");
    }
    else if (type === V3EntryType.RAW && valueObj.raw === undefined) {
        throw new InvalidEntryValueError("Expected raw value");
    }
    else if (type === V3EntryType.BOOLEAN_ARRAY && valueObj.bool_array === undefined) {
        throw new InvalidEntryValueError("Expected boolean array value");
    }
    else if (type === V3EntryType.DOUBLE_ARRAY && valueObj.double_array === undefined) {
        throw new InvalidEntryValueError("Expected double array value");
    }
    else if (type === V3EntryType.STRING_ARRAY && valueObj.str_array === undefined) {
        throw new InvalidEntryValueError("Expected string array value");
    }
    else if (type === V3EntryType.RPC && valueObj.rpc === undefined) {
        throw new InvalidEntryValueError("Expected RPC value");
    }
}

export function entryFlagsToUInt8(flags: V3EntryFlags): number {
    return (typeof flags == "object" && flags !== null && flags.persistent ? 1 : 0);
}

export function UInt8ToEntryFlags(flagByte: number): V3EntryFlags {
    return {
        persistent: (flagByte & 0x1) === 1
    }
}

// KEEP-ALIVE
export interface V3KeepAliveMessageWrapper {
    message: V3KeepAliveMessage,
    newOffset: number;
}

export function keepAliveMessageToBuffer(): Buffer {
    return Buffer.from([V3MessageType.KEEP_ALIVE]);
}

export function keepAliveMessageFromBuffer(buf: Buffer, offset: number = 0): V3KeepAliveMessageWrapper {
    checkBufferLength(buf, offset, 1);
    checkMessageType(buf, offset, V3MessageType.KEEP_ALIVE);

    return {
        message: {
            type: V3MessageType.KEEP_ALIVE
        },
        newOffset: offset + 1
    }
}

// CLIENT HELLO
export interface V3ClientHelloMessageWrapper {
    message: V3ClientHelloMessage,
    newOffset: number;
}

export function clientHelloMessageToBuffer(msg: V3ClientHelloMessage): Buffer {
    return Buffer.concat([
        Buffer.from([V3MessageType.CLIENT_HELLO, 3, 0]),
        encodeLEB128String(msg.clientIdent)
    ]);
}

export function clientHelloMessageFromBuffer(buf: Buffer, offset: number = 0): V3ClientHelloMessageWrapper {
    checkBufferLength(buf, offset, 4); // At least 4 bytes (type, 16-bit revision, string)
    checkMessageType(buf, offset, V3MessageType.CLIENT_HELLO);

    const protocolMajor = buf.readUInt8(offset + 1);
    const protocolMinor = buf.readUInt8(offset + 2);
    const clientIdent = decodeLEB128String(buf, offset + 3);

    return {
        message: {
            type: V3MessageType.CLIENT_HELLO,
            protocolMajor,
            protocolMinor,
            clientIdent: clientIdent.value
        },
        newOffset: clientIdent.offset
    }
}

// PROTO VERSION UNSUPPORTED
export interface V3ProtoVersionUnsupportedMessageWrapper {
    message: V3ProtoVersionUnsupportedMessage;
    newOffset: number;
}

export function protoVersionUnsupportedMessageToBuffer(msg: V3ProtoVersionUnsupportedMessage): Buffer {
    const version: Buffer = Buffer.from([
        msg.serverSupportedProtocolMajor,
        msg.serverSupportedProtocolMinor
    ]);

    return Buffer.concat([
        Buffer.from([V3MessageType.PROTO_VERSION_UNSUPPORTED]),
        version
    ]);
}

export function protoVersionUnsupportedMessageFromBuffer(buf: Buffer, offset: number = 0): V3ProtoVersionUnsupportedMessageWrapper {
    checkBufferLength(buf, offset, 3);
    checkMessageType(buf, offset, V3MessageType.PROTO_VERSION_UNSUPPORTED);

    const serverSupportedProtocolMajor = buf.readUInt8(offset + 1);
    const serverSupportedProtocolMinor = buf.readUInt8(offset + 2);

    return {
        message: {
            type: V3MessageType.PROTO_VERSION_UNSUPPORTED,
            serverSupportedProtocolMajor,
            serverSupportedProtocolMinor
        },
        newOffset: offset + 3
    }
}

// SERVER HELLO COMPLETE
export interface V3ServerHelloCompleteMessageWrapper {
    message: V3ServerHelloCompleteMessage;
    newOffset: number;
}

export function serverHelloCompleteMessageToBuffer(): Buffer {
    return Buffer.from([V3MessageType.SERVER_HELLO_COMPLETE]);
}

export function serverHelloCompleteMessageFromBuffer(buf: Buffer, offset: number = 0): V3ServerHelloCompleteMessageWrapper {
    checkBufferLength(buf, offset, 1);
    checkMessageType(buf, offset, V3MessageType.SERVER_HELLO_COMPLETE);

    return {
        message: {
            type: V3MessageType.SERVER_HELLO_COMPLETE
        },
        newOffset: offset + 1
    }
}

// SERVER HELLO
export interface V3ServerHelloMessageWrapper {
    message: V3ServerHelloMessage;
    newOffset: number;
}

export function serverHelloMessageToBuffer(msg: V3ServerHelloMessage): Buffer {
    return Buffer.concat([
        Buffer.from([V3MessageType.SERVER_HELLO, msg.clientPreviouslySeen ? 1 : 0]),
        encodeLEB128String(msg.serverIdentity)
    ]);
}

export function serverHelloMessageFromBuffer(buf: Buffer, offset: number = 0): V3ServerHelloMessageWrapper {
    checkBufferLength(buf, offset, 3);
    checkMessageType(buf, offset, V3MessageType.SERVER_HELLO);

    const flags = buf[offset + 1];
    const serverIdentity = decodeLEB128String(buf, offset + 2);

    return {
        message: {
            type: V3MessageType.SERVER_HELLO,
            clientPreviouslySeen: (flags & 0x1) === 1,
            serverIdentity: serverIdentity.value
        },
        newOffset: serverIdentity.offset
    }
}

// CLIENT HELLO COMPLETE
export interface V3ClientHelloCompleteMessageWrapper {
    message: V3ClientHelloCompleteMessage;
    newOffset: number;
}

export function clientHelloCompleteMessageToBuffer(): Buffer {
    return Buffer.from([V3MessageType.CLIENT_HELLO_COMPLETE]);
}

export function clientHelloCompleteMessageFromBuffer(buf: Buffer, offset: number = 0): V3ClientHelloCompleteMessageWrapper {
    checkBufferLength(buf, offset, 1);
    checkMessageType(buf, offset, V3MessageType.CLIENT_HELLO_COMPLETE);

    return {
        message: {
            type: V3MessageType.CLIENT_HELLO_COMPLETE
        },
        newOffset: offset + 1
    }
}

// ENTRY ASSIGNMENT
export interface V3EntryAssignmentMessageWrapper {
    message: V3EntryAssignmentMessage;
    newOffset: number;
}

export function entryValueToBuffer(type: V3EntryType, valueObj: NTEntryValue): Buffer {
    checkEntryValue(type, valueObj);

    switch (type) {
        case V3EntryType.BOOLEAN: {
            return Buffer.from([valueObj.bool ? 1 : 0]);
        }
        case V3EntryType.DOUBLE: {
            const doubleBuf = Buffer.alloc(8);
            ieee754.write(doubleBuf, valueObj.double, 0, false, 52, 8);
            return doubleBuf;
        }
        case V3EntryType.STRING: {
            return encodeLEB128String(valueObj.str);
        }
        case V3EntryType.RAW: {
            return Buffer.concat([
                toUnsignedLEB128(valueObj.raw.length),
                valueObj.raw
            ]);
        }
        case V3EntryType.BOOLEAN_ARRAY: {
            return Buffer.concat([
                Buffer.from([valueObj.bool_array.length]),
                Buffer.from(valueObj.bool_array.map(val => {
                    return val ? 1 : 0
                }))
            ]);
        }
        case V3EntryType.DOUBLE_ARRAY: {
            return Buffer.concat([
                Buffer.from([valueObj.double_array.length]),
                Buffer.concat(valueObj.double_array.map(value => {
                    const buf = Buffer.alloc(8);
                    ieee754.write(buf, value, 0, false, 52, 8);
                    return buf;
                }))
            ]);
        }
        case V3EntryType.STRING_ARRAY: {
            return Buffer.concat([
                Buffer.from([valueObj.str_array.length]),
                Buffer.concat(valueObj.str_array.map(value => {
                    return encodeLEB128String(value);
                }))
            ]);
        }
        case V3EntryType.RPC: {
            const encodedRpcBuf = encodeRPCDefinition(valueObj.rpc as V3RPCDefinition);
            return Buffer.concat([
                Buffer.from([encodedRpcBuf.length]),
                encodedRpcBuf
            ]);
        }
    }
}

export interface V3EntryValueWrapper {
    value: NTEntryValue;
    newOffset: number;
}

export function entryValueFromBuffer(type: V3EntryType, buf: Buffer, offset: number = 0): V3EntryValueWrapper {
    switch (type) {
        case V3EntryType.BOOLEAN: {
            checkBufferLength(buf, offset, 1);
            return {
                value: {
                    bool: buf[offset] === 1
                },
                newOffset: offset + 1
            }
        }
        case V3EntryType.DOUBLE: {
            checkBufferLength(buf, offset, 8);
            return {
                value: {
                    double: ieee754.read(buf, offset, false, 52, 8)
                },
                newOffset: offset + 8
            }
        }
        case V3EntryType.STRING: {
            const strResult = decodeLEB128String(buf, offset);
            return {
                value: {
                    str: strResult.value
                },
                newOffset: strResult.offset
            }
        }
        case V3EntryType.RAW: {
            const dataLenResult = fromUnsignedLEB128(buf, offset);
            const dataLen = dataLenResult.value;

            checkBufferLength(buf, dataLenResult.offset, dataLen);

            const rawBuf = Buffer.allocUnsafe(dataLen);
            buf.copy(rawBuf, 0, dataLenResult.offset, dataLenResult.offset + dataLen);

            return {
                value: {
                    raw: rawBuf
                },
                newOffset: dataLenResult.offset + dataLen
            }
        }
        case V3EntryType.BOOLEAN_ARRAY: {
            const numElems = buf.readUInt8(offset);

            let bufOffset = offset + 1;
            checkBufferLength(buf, bufOffset, numElems);

            const boolArray: boolean[] = [];
            for (let i = 0; i < numElems; i++) {
                boolArray.push(buf[bufOffset] === 1);
                bufOffset++;
            }

            return {
                value: {
                    bool_array: boolArray
                },
                newOffset: bufOffset
            }
        }
        case V3EntryType.DOUBLE_ARRAY: {
            const numElems = buf.readUInt8(offset);

            let bufOffset = offset + 1;
            checkBufferLength(buf, bufOffset, numElems * 8);

            const doubleArray: number[] = [];
            for (let i = 0; i < numElems; i++) {
                doubleArray.push(ieee754.read(buf, bufOffset, false, 52, 8));
                bufOffset += 8;
            }

            return {
                value: {
                    double_array: doubleArray
                },
                newOffset: bufOffset
            }
        }
        case V3EntryType.STRING_ARRAY: {
            const numElems = buf.readUInt8(offset);

            let bufOffset = offset + 1;
            checkBufferLength(buf, bufOffset, numElems);

            const strArray: string[] = [];
            for (let i = 0; i < numElems; i++) {
                const strResult = decodeLEB128String(buf, bufOffset);
                strArray.push(strResult.value);
                bufOffset = strResult.offset;
            }

            return {
                value: {
                    str_array: strArray
                },
                newOffset: bufOffset
            }
        }
        case V3EntryType.RPC: {
            const bufLenResult = fromUnsignedLEB128(buf, offset);
            const bufLen = bufLenResult.value;

            checkBufferLength(buf, bufLenResult.offset, bufLen);

            // The buffer starting at bufLenResult.offset now holds the RPC
            // definition entry
            const rpcDefinitionResult = decodeRPCDefinition(buf, bufLenResult.offset);

            return {
                value: {
                    rpc: rpcDefinitionResult.value
                },
                newOffset: rpcDefinitionResult.newOffset
            };
        }
    }
}

export function entryAssignmentMessageToBuffer(msg: V3EntryAssignmentMessage): Buffer {
    checkEntryValue(msg.entryType, msg.entryValue);

    const nameBuf = encodeLEB128String(msg.entryName);

    const idBuf = Buffer.alloc(2);
    idBuf.writeUInt16BE(msg.entryId);

    const seqBuf = Buffer.alloc(2);
    seqBuf.writeUInt16BE(msg.entrySeq);

    return Buffer.concat([
        Buffer.from([V3MessageType.ENTRY_ASSIGNMENT]),
        nameBuf,
        Buffer.from([msg.entryType]),
        idBuf,
        seqBuf,
        Buffer.from([entryFlagsToUInt8(msg.entryFlags as V3EntryFlags)]),
        entryValueToBuffer(msg.entryType, msg.entryValue)
    ]);
}

export function entryAssignmentMessageFromBuffer(buf: Buffer, offset: number = 0): V3EntryAssignmentMessageWrapper {
    checkBufferLength(buf, offset, 9);
    checkMessageType(buf, offset, V3MessageType.ENTRY_ASSIGNMENT);

    let bufOffset = offset + 1;

    // Extract the string
    const entryNameResult = decodeLEB128String(buf, bufOffset);
    const entryName = entryNameResult.value;

    // The offset now points to the byte AFTER the end of the string
    bufOffset = entryNameResult.offset;

    if (!(buf[bufOffset] in ByteToV3EntryType)) {
        throw new InvalidEntryTypeError("Invalid Type Found");
    }
    const entryType = (buf[bufOffset] as V3EntryType);

    bufOffset += 1; // This will now point to the ID
    const entryId = buf.readUInt16BE(bufOffset);

    bufOffset += 2; // This will now point to the Sequence
    const entrySeq = buf.readUInt16BE(bufOffset);

    bufOffset += 2; // This will now point to the Flags
    const entryFlags = UInt8ToEntryFlags(buf[bufOffset]);

    bufOffset += 1; // This will now point at the EntryValue
    const entryValueResult = entryValueFromBuffer(entryType, buf, bufOffset);

    return {
        message: {
            type: V3MessageType.ENTRY_ASSIGNMENT,
            entryName,
            entryType,
            entryId,
            entrySeq,
            entryFlags,
            entryValue: entryValueResult.value
        },
        newOffset: entryValueResult.newOffset
    }

}

// ENTRY UPDATE
export interface V3EntryUpdateMessageWrapper {
    message: V3EntryUpdateMessage;
    newOffset: number;
}

export function entryUpdateMessageToBuffer(msg: V3EntryUpdateMessage): Buffer {
    checkEntryValue(msg.entryType, msg.entryValue);

    const idBuf = Buffer.alloc(2);
    idBuf.writeUInt16BE(msg.entryId);

    const seqBuf = Buffer.alloc(2);
    seqBuf.writeUInt16BE(msg.entrySeq);

    return Buffer.concat([
        Buffer.from([V3MessageType.ENTRY_UPDATE]),
        idBuf,
        seqBuf,
        Buffer.from([msg.entryType]),
        entryValueToBuffer(msg.entryType, msg.entryValue)
    ]);
}

export function entryUpdateMessageFromBuffer(buf: Buffer, offset: number = 0): V3EntryUpdateMessageWrapper {
    checkBufferLength(buf, offset, 7);
    checkMessageType(buf, offset, V3MessageType.ENTRY_UPDATE);

    let bufOffset = offset + 1;
    const entryId = buf.readUInt16BE(bufOffset);

    bufOffset += 2; // Now pointing to seq
    const entrySeq = buf.readUInt16BE(bufOffset);

    bufOffset += 2; // Now pointing to type
    if (!(buf[bufOffset] in ByteToV3EntryType)) {
        throw new InvalidEntryTypeError("Invalid Type Found");
    }
    const entryType = (buf[bufOffset] as V3EntryType);

    bufOffset += 1; // Now pointing to value
    const entryValueResult = entryValueFromBuffer(entryType, buf, bufOffset);

    return {
        message: {
            type: V3MessageType.ENTRY_UPDATE,
            entryId,
            entrySeq,
            entryType,
            entryValue: entryValueResult.value
        },
        newOffset: entryValueResult.newOffset
    };
}

// ENTRY FLAGS UPDATE
export interface V3EntryFlagsUpdateMessageWrapper {
    message: V3EntryFlagsUpdateMessage;
    newOffset: number;
}

export function entryFlagsUpdateMessageToBuffer(msg: V3EntryFlagsUpdateMessage): Buffer {
    const idBuf = Buffer.alloc(2);
    idBuf.writeUInt16BE(msg.entryId);

    return Buffer.concat([
        Buffer.from([V3MessageType.ENTRY_FLAGS_UPDATE]),
        idBuf,
        Buffer.from([entryFlagsToUInt8(msg.entryFlags as V3EntryFlags)])
    ]);
}

export function entryFlagsUpdateMessageFromBuffer(buf: Buffer, offset: number = 0): V3EntryFlagsUpdateMessageWrapper {
    checkBufferLength(buf, offset, 4);
    checkMessageType(buf, offset, V3MessageType.ENTRY_FLAGS_UPDATE);
    const entryId = buf.readUInt16BE(offset + 1);
    const entryFlags = UInt8ToEntryFlags(buf[offset + 3]);

    return {
        message: {
            type: V3MessageType.ENTRY_FLAGS_UPDATE,
            entryId,
            entryFlags
        },
        newOffset: offset + 4
    };
}

// ENTRY DELETE
export interface V3EntryDeleteMessageWrapper {
    message: V3EntryDeleteMessage;
    newOffset: number;
}

export function entryDeleteMessageToBuffer(msg: V3EntryDeleteMessage): Buffer {
    const buf = Buffer.alloc(3);
    buf[0] = V3MessageType.ENTRY_DELETE;
    buf.writeUInt16BE(msg.entryId, 1);

    return buf;
}

export function entryDeleteMessageFromBuffer(buf: Buffer, offset: number = 0): V3EntryDeleteMessageWrapper {
    checkBufferLength(buf, offset, 3);
    checkMessageType(buf, offset, V3MessageType.ENTRY_DELETE);

    return {
        message: {
            type: V3MessageType.ENTRY_DELETE,
            entryId: buf.readUInt16BE(1)
        },
        newOffset: offset + 3
    }
}

// CLEAR ALL ENTRIES
export interface V3ClearAllEntriesMessageWrapper {
    message: V3ClearAllEntriesMessage;
    newOffset: number;
}

export function clearAllEntriesMessageToBuffer(): Buffer {
    const buf = Buffer.alloc(5);
    buf[0] = V3MessageType.CLEAR_ALL_ENTRIES;
    buf.writeUInt32BE(CLEAR_ALL_ENTRIES_MAGIC_VALUE, 1);
    return buf;
}

export function clearAllEntriesMessageFromBuffer(buf: Buffer, offset: number = 0): V3ClearAllEntriesMessageWrapper {
    checkBufferLength(buf, offset, 5);
    checkMessageType(buf, offset, V3MessageType.CLEAR_ALL_ENTRIES);

    if (buf.readUInt32BE(1) !== CLEAR_ALL_ENTRIES_MAGIC_VALUE) {
        throw new InvalidEntryValueError("Invalid Magic number for CLEAR ALL ENTRIES");
    }

    return {
        message: {
            type: V3MessageType.CLEAR_ALL_ENTRIES
        },
        newOffset: offset + 5
    }
}

// RPC EXECUTE
export interface V3RPCExecuteMessageWrapper {
    message: V3RPCExecuteMessage;
    newOffset: number;
}

export function rpcExecuteMessageToBuffer(msg: V3RPCExecuteMessage): Buffer {
    const headerBuf = Buffer.alloc(3);
    headerBuf[0] = V3MessageType.RPC_EXECUTE;
    headerBuf.writeUInt16BE(msg.rpcDefinitionId, 1);

    const idBuf = Buffer.alloc(2);
    idBuf.writeUInt16BE(msg.uniqueId);

    const numParamsBuf = toUnsignedLEB128(msg.parameters.length);

    const paramBufs: Buffer[] = msg.parameters.map(param => {
        return entryValueToBuffer(param.type, param.value);
    });

    return Buffer.concat([
        headerBuf,
        idBuf,
        numParamsBuf,
        Buffer.concat(paramBufs)
    ]);
}

export function rpcExecuteMessageFromBuffer(rpcDefinitions: Map<number, V3RPCDefinition>, buf: Buffer, offset: number = 0): V3RPCExecuteMessageWrapper {
    checkBufferLength(buf, offset, 6);
    checkMessageType(buf, offset, V3MessageType.RPC_EXECUTE);

    let bufOffset = offset + 1; // Points to Definition Entry ID
    const rpcDefinitionId = buf.readUInt16BE(bufOffset);

    if (!rpcDefinitions.has(rpcDefinitionId)) {
        throw new Error("No RPC definition found");
    }

    const rpcDefinition = rpcDefinitions.get(rpcDefinitionId);

    bufOffset += 2; // Points to unique ID
    const uniqueId = buf.readUInt16BE(bufOffset);

    bufOffset += 2; // Points to param value length
    const numParamResults = fromUnsignedLEB128(buf, bufOffset);
    const numParams = numParamResults.value;

    if (numParams !== rpcDefinition.parameters.length) {
        throw new Error("Mismatch in RPC parameter counts");
    }

    const parameters: V3RPCParameter[] = [];

    bufOffset = numParamResults.offset; // Now points to the first param value
    for (let i = 0; i < numParams; i++) {
        const paramDef = rpcDefinition.parameters[i];
        const valueResult = entryValueFromBuffer(paramDef.type, buf, bufOffset);
        parameters.push({
            type: paramDef.type,
            name: paramDef.name.slice(),
            value: valueResult.value
        });
        bufOffset = valueResult.newOffset;
    }

    return {
        message: {
            type: V3MessageType.RPC_EXECUTE,
            rpcDefinitionId,
            uniqueId,
            parameters
        },
        newOffset: bufOffset
    }
}

// RPC RESPONSE
export interface V3RPCResponseMessageWrapper {
    message: V3RPCResponseMessage;
    newOffset: number;
}

export function rpcResponseMessageToBuffer(msg: V3RPCResponseMessage): Buffer {
    const headerBuf: Buffer = Buffer.alloc(3);
    headerBuf[0] = V3MessageType.RPC_RESPONSE;
    headerBuf.writeUInt16BE(msg.rpcDefinitionId, 1);

    const idBuf = Buffer.alloc(2);
    idBuf.writeUInt16BE(msg.uniqueId);

    const numResultsBuf = toUnsignedLEB128(msg.results.length);

    const resultBufs: Buffer[] = msg.results.map(result => {
        return entryValueToBuffer(result.type, result.value);
    });

    return Buffer.concat([
        headerBuf,
        idBuf,
        numResultsBuf,
        Buffer.concat(resultBufs)
    ]);
}

export function rpcResponseMessageFromBuffer(rpcDefinitions: Map<number, V3RPCDefinition>, buf: Buffer, offset: number = 0): V3RPCResponseMessageWrapper {
    checkBufferLength(buf, offset, 6);
    checkMessageType(buf, offset, V3MessageType.RPC_RESPONSE);

    let bufOffset = offset + 1; // Points to Definiteion Entry ID
    const rpcDefinitionId = buf.readUInt16BE(bufOffset);

    if (!rpcDefinitions.has(rpcDefinitionId)) {
        throw new Error("No RPC definition found");
    }

    const rpcDef = rpcDefinitions.get(rpcDefinitionId);

    bufOffset += 2; // Points to unique ID
    const uniqueId = buf.readUInt16BE(bufOffset);

    bufOffset += 2; // Points to result length value
    const numResultsResult = fromUnsignedLEB128(buf, bufOffset);
    const numResults = numResultsResult.value

    if (numResults !== rpcDef.results.length) {
        throw new Error("Mismatch in RPC result counts");
    }

    const results: V3RPCResult[] = [];

    bufOffset = numResultsResult.offset;
    for (let i = 0; i < numResults; i++) {
        const resultDef = rpcDef.results[i];
        const valueResult = entryValueFromBuffer(resultDef.type, buf, bufOffset);
        results.push({
            type: resultDef.type,
            name: resultDef.name.slice(),
            value: valueResult.value
        });
        bufOffset = valueResult.newOffset;
    }

    return {
        message: {
            type: V3MessageType.RPC_RESPONSE,
            rpcDefinitionId,
            uniqueId,
            results
        },
        newOffset: bufOffset
    }
}

// Utility functions
export function getMessageType(buf: Buffer, offset: number = 0): V3MessageType {
    if (!(buf[offset] in ByteToV3MessageType)) {
        throw new InvalidMessageTypeError(`Invalid message type found at offset ${offset}`);
    }

    return (buf[offset] as V3MessageType);
}

export interface V3MessageWrapper {
    message: V3Message;
    newOffset: number;
}

export function getNextAvailableMessage(rpcDefinitions: Map<number, V3RPCDefinition>, buf: Buffer, offset: number = 0): V3MessageWrapper | undefined {
    let msgType: V3MessageType;

    try {
        msgType = getMessageType(buf, offset);
    }
    catch (e) {
        // console.log("ERR while getting message type: ", e);
        return undefined;
    }

    try {
        switch(msgType) {
            case V3MessageType.KEEP_ALIVE: {
                return {
                    message: {
                        type: msgType
                    },
                    newOffset: offset + 1
                };
            }
            case V3MessageType.CLIENT_HELLO: {
                const result = clientHelloMessageFromBuffer(buf, offset);
                return {
                    message: result.message,
                    newOffset: result.newOffset
                };
            }
            case V3MessageType.PROTO_VERSION_UNSUPPORTED: {
                const result = protoVersionUnsupportedMessageFromBuffer(buf, offset);
                return {
                    message: result.message,
                    newOffset: result.newOffset
                }
            }
            case V3MessageType.SERVER_HELLO_COMPLETE: {
                return {
                    message: {
                        type: msgType
                    },
                    newOffset: offset + 1
                }
            }
            case V3MessageType.SERVER_HELLO: {
                const result = serverHelloMessageFromBuffer(buf, offset);
                return {
                    message: result.message,
                    newOffset: result.newOffset
                }
            }
            case V3MessageType.CLIENT_HELLO_COMPLETE: {
                const result = clientHelloCompleteMessageFromBuffer(buf, offset);
                return {
                    ...result
                };
            }
            case V3MessageType.ENTRY_UPDATE: {
                const result = entryUpdateMessageFromBuffer(buf, offset);
                return {
                    ...result
                }
            }
            case V3MessageType.ENTRY_ASSIGNMENT: {
                const result = entryAssignmentMessageFromBuffer(buf, offset);
                return {
                    ...result
                }
            }
            case V3MessageType.ENTRY_FLAGS_UPDATE: {
                const result = entryFlagsUpdateMessageFromBuffer(buf, offset);
                return {
                    ...result
                }
            }
            case V3MessageType.ENTRY_DELETE: {
                const result = entryDeleteMessageFromBuffer(buf, offset);
                return {
                    ...result
                }
            }
            case V3MessageType.CLEAR_ALL_ENTRIES: {
                const result = clearAllEntriesMessageFromBuffer(buf, offset);
                return {
                    ...result
                }
            }
            case V3MessageType.RPC_EXECUTE: {
                const result = rpcExecuteMessageFromBuffer(rpcDefinitions, buf, offset);
                return {
                    ...result
                }
            }
            case V3MessageType.RPC_RESPONSE: {
                const result = rpcResponseMessageFromBuffer(rpcDefinitions, buf, offset);
                return {
                    ...result
                }
            }
        }
    }
    catch(e) {
        return undefined;
    }
}

export interface RPCDefinitionDecodeResult {
    value: V3RPCDefinition;
    newOffset: number;
}

export function decodeRPCDefinition(buf: Buffer, offset: number = 0): RPCDefinitionDecodeResult {
    let bufOffset = offset;

    if (buf[bufOffset] !== 1) {
        throw new Error("Unsupported RPC Version");
    }

    bufOffset += 1; // This now points to the Name string
    const procedureNameResult = decodeLEB128String(buf, bufOffset);
    const procedureName = procedureNameResult.value;

    bufOffset = procedureNameResult.offset; // This now points to the number of params
    const numParams = buf[bufOffset];

    bufOffset += 1; // This now points to the first parameter spec definition

    const params: V3RPCParameter[] = [];

    for (let i = 0; i < numParams; i++) {
        const decodedParam = decodeRPCParameterSpec(buf, bufOffset);
        params.push(decodedParam.value);

        bufOffset = decodedParam.newOffset;
    }

    const numResults = buf[bufOffset];
    bufOffset += 1;

    const results: V3RPCResult[] = [];

    for (let i = 0; i < numResults; i++) {
        const decodedResult = decodeRPCResultSpec(buf, bufOffset);
        results.push(decodedResult.value);

        bufOffset = decodedResult.newOffset;
    }

    // bufOffset will now point to the next byte after the RPC def

    return {
        value: {
            name: procedureName,
            parameters: params,
            results
        },
        newOffset: bufOffset
    }
}

export function encodeRPCDefinition(rpcDef: V3RPCDefinition): Buffer {
    const paramBuffers: Buffer[] = rpcDef.parameters.map(param => {
        return encodeRPCParameterSpec(param);
    });

    const resultBuffers: Buffer[] = rpcDef.results.map(result => {
        return encodeRPCResultSpec(result);
    });

    return Buffer.concat([
        Buffer.from([1]),
        encodeLEB128String(rpcDef.name),
        Buffer.from([paramBuffers.length]),
        Buffer.concat(paramBuffers),
        Buffer.from([resultBuffers.length]),
        Buffer.concat(resultBuffers)
    ]);
}

interface RPCParamDecodeResult {
    value: V3RPCParameter;
    newOffset: number;
}

function decodeRPCParameterSpec(buf: Buffer, offset: number = 0): RPCParamDecodeResult {
    let bufOffset = offset;
    const type = (buf[bufOffset] as V3EntryType);

    bufOffset += 1; // This now points at the param name
    const paramNameResult = decodeLEB128String(buf, bufOffset);
    const paramName = paramNameResult.value;

    bufOffset = paramNameResult.offset; // This now points at the default value
    const defaultValueResult = entryValueFromBuffer(type, buf, bufOffset);

    return {
        value: {
            type,
            name: paramName,
            value: defaultValueResult.value
        },
        newOffset: defaultValueResult.newOffset
    }
}

function encodeRPCParameterSpec(param: V3RPCParameter): Buffer {
    return Buffer.concat([
        Buffer.from([param.type]),
        encodeLEB128String(param.name),
        entryValueToBuffer(param.type, param.value)
    ]);
}

interface RPCResultDecodeResult {
    value: V3RPCResult;
    newOffset: number;
}

function decodeRPCResultSpec(buf: Buffer, offset: number = 0): RPCResultDecodeResult {
    let bufOffset = offset;
    const type = (buf[bufOffset] as V3EntryType);

    bufOffset += 1; // This now points at the result name
    const resultNameResult = decodeLEB128String(buf, bufOffset);

    return {
        value: {
            type,
            name: resultNameResult.value,
            value: {}
        },
        newOffset: resultNameResult.offset
    }
}

function encodeRPCResultSpec(result: V3RPCResult): Buffer {
    return Buffer.concat([
        Buffer.from([result.type]),
        encodeLEB128String(result.name)
    ]);
}
