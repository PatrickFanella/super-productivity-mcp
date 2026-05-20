package mcpadapter

import "encoding/json"

const jsonRPCVersion = "2.0"

// MCP JSON-RPC 2.0 wire types.
type rpcMsg struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type contentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

func (s *Server) reply(enc *json.Encoder, id json.RawMessage, result any) {
	_ = enc.Encode(rpcMsg{JSONRPC: jsonRPCVersion, ID: id, Result: result})
}

func (s *Server) replyErr(enc *json.Encoder, id json.RawMessage, code int, msg string) {
	_ = enc.Encode(rpcMsg{JSONRPC: jsonRPCVersion, ID: id, Error: &rpcError{Code: code, Message: msg}})
}
