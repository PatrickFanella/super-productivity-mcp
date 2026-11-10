// Package localrest delivers requests to Super Productivity's Local REST API
// (stock v20: http://127.0.0.1:3876, Bearer token). It owns transport,
// envelope decoding and error classification; it does not know which catalog
// actions use it (see internal/bridge).
//
// Two properties matter for safety:
//
//   - The token is only ever sent to the configured origin: no proxy, no
//     redirects, and it never appears in an error or log line.
//   - Every failure is classified by whether the request may have run. A
//     failure before the request was written is safe to report as
//     unavailable; a failure afterwards on a mutation is OUTCOME_UNKNOWN, so
//     callers check state instead of retrying or trying another adapter.
package localrest

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

// DefaultTimeout bounds one request. The app gives its renderer 15 seconds.
const DefaultTimeout = 20 * time.Second

// maxResponseBytes bounds a response body; a full task list can be large.
const maxResponseBytes = 32 << 20

// maxUpstreamMessage bounds how much of an upstream error message is kept.
const maxUpstreamMessage = 200

// Error codes produced by this package. Upstream route codes such as
// TASK_NOT_FOUND or UNSUPPORTED_FIELD are passed through unchanged, except
// INVALID_INPUT and INVALID_REQUEST_BODY, which become INVALID_REQUEST to
// match the plugin bridge.
const (
	CodeNotConfigured     = "LOCAL_REST_NOT_CONFIGURED"
	CodeMisconfigured     = "LOCAL_REST_MISCONFIGURED"
	CodeUnavailable       = "LOCAL_REST_UNAVAILABLE"
	CodeUnauthorized      = "LOCAL_REST_UNAUTHORIZED"
	CodeUnsupportedRoute  = "LOCAL_REST_UNSUPPORTED_ROUTE"
	CodeMalformedResponse = "LOCAL_REST_MALFORMED_RESPONSE"
	CodeRedirectRefused   = "LOCAL_REST_REDIRECT_REFUSED"
	CodeFailed            = "LOCAL_REST_FAILED"
	CodeOutcomeUnknown    = "OUTCOME_UNKNOWN"
	CodeTimeout           = "TIMEOUT"
	CodeCanceled          = "CANCELED"
	CodeInvalidRequest    = "INVALID_REQUEST"
)

// Config selects the Local REST endpoint.
type Config struct {
	// BaseURL is the origin plus an optional path prefix, for example
	// http://127.0.0.1:3876. A prefix such as /api is kept as written.
	BaseURL string
	// Token is sent as "Authorization: Bearer <token>" when non-empty.
	Token string
	// AllowRemote permits a host other than loopback. The API only listens
	// on 127.0.0.1, so a remote host means a tunnel or proxy the user chose.
	AllowRemote bool
	// Timeout bounds each request; zero means DefaultTimeout.
	Timeout time.Duration
}

// Client sends requests to one Local REST origin. It is safe for concurrent use.
type Client struct {
	base    *url.URL
	token   string
	timeout time.Duration
	http    *http.Client
}

// New validates cfg and returns a client. An empty BaseURL returns a
// LOCAL_REST_NOT_CONFIGURED error; an unusable one LOCAL_REST_MISCONFIGURED.
func New(cfg Config) (*Client, error) {
	raw := strings.TrimSpace(cfg.BaseURL)
	if raw == "" {
		return nil, domain.TypedError{Code: CodeNotConfigured, Message: "Local REST is not configured; set SP_LOCAL_REST_URL"}
	}
	base, err := url.Parse(raw)
	if err != nil || base.Host == "" {
		return nil, misconfigured("SP_LOCAL_REST_URL must be an absolute URL such as http://127.0.0.1:3876")
	}
	if base.Scheme != "http" && base.Scheme != "https" {
		return nil, misconfigured("SP_LOCAL_REST_URL must use http or https")
	}
	if base.User != nil {
		return nil, misconfigured("SP_LOCAL_REST_URL must not contain credentials; use SP_LOCAL_REST_TOKEN")
	}
	if base.RawQuery != "" || base.Fragment != "" {
		return nil, misconfigured("SP_LOCAL_REST_URL must not contain a query or fragment")
	}
	if !cfg.AllowRemote && !isLoopback(base.Hostname()) {
		return nil, misconfigured("SP_LOCAL_REST_URL must point at a loopback address; set SP_LOCAL_REST_ALLOW_REMOTE=1 to use another host")
	}
	base.Path = strings.TrimRight(base.Path, "/")
	base.RawPath = ""
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	transport := &http.Transport{
		// Never route the token through a proxy, even if HTTP_PROXY is set.
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		MaxIdleConns:          4,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: timeout,
	}
	return &Client{
		base:    base,
		token:   strings.TrimSpace(cfg.Token),
		timeout: timeout,
		http: &http.Client{
			Transport: transport,
			// Never follow a redirect: it could carry the token elsewhere.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

func misconfigured(msg string) error {
	return domain.TypedError{Code: CodeMisconfigured, Message: msg}
}

func isLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// Request is one Local REST call.
type Request struct {
	Method string
	// Path starts with "/"; callers escape path segments.
	Path string
	// Body is encoded as JSON when non-nil.
	Body any
	// Mutation marks a request that changes data. A failure after the
	// request was sent is then reported as OUTCOME_UNKNOWN.
	Mutation bool
}

type envelope struct {
	OK    *bool           `json:"ok"`
	Data  json.RawMessage `json:"data"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// Do sends req and returns the envelope's data on {ok:true}. Every error is a
// domain.TypedError.
func (c *Client) Do(ctx context.Context, req Request) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	var body io.Reader
	if req.Body != nil {
		b, err := json.Marshal(req.Body)
		if err != nil {
			return nil, domain.TypedError{Code: CodeInvalidRequest, Message: "request body is not JSON-encodable"}
		}
		body = bytes.NewReader(b)
	}
	httpReq, err := http.NewRequestWithContext(ctx, req.Method, c.base.String()+req.Path, body)
	if err != nil {
		return nil, domain.TypedError{Code: CodeInvalidRequest, Message: "invalid Local REST request"}
	}
	httpReq.Header.Set("Accept", "application/json")
	if body != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.token)
	}

	// WroteRequest runs on the transport's goroutine.
	var wrote atomic.Bool
	trace := &httptrace.ClientTrace{WroteRequest: func(info httptrace.WroteRequestInfo) { wrote.Store(info.Err == nil) }}
	httpReq = httpReq.WithContext(httptrace.WithClientTrace(ctx, trace))

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, c.transportError(ctx, req, wrote.Load(), err)
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if readErr != nil {
		return nil, c.transportError(ctx, req, true, readErr)
	}
	if len(raw) > maxResponseBytes {
		return nil, uncertainOr(req, CodeMalformedResponse, "Local REST response exceeds the size limit", resp.StatusCode)
	}
	return decode(req, resp.StatusCode, raw)
}

func (c *Client) transportError(ctx context.Context, req Request, wrote bool, err error) error {
	if !wrote {
		// Nothing reached the server, so nothing ran.
		if errors.Is(ctx.Err(), context.Canceled) {
			return domain.TypedError{Code: CodeCanceled, Message: "Local REST request canceled before it was sent"}
		}
		return domain.TypedError{
			Code:      CodeUnavailable,
			Message:   "Super Productivity's Local REST API did not accept the connection. Check that the app is running and the API is enabled in Settings → Misc.",
			Retryable: true,
		}
	}
	if req.Mutation {
		return outcomeUnknown("the request was sent but no complete answer arrived")
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return domain.TypedError{Code: CodeCanceled, Message: "Local REST request canceled"}
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || isTimeout(err) {
		return domain.TypedError{Code: CodeTimeout, Message: fmt.Sprintf("Local REST did not answer within %s", c.timeout), Retryable: true}
	}
	return domain.TypedError{Code: CodeFailed, Message: "Local REST connection failed before a complete answer", Retryable: true}
}

func isTimeout(err error) bool {
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

func outcomeUnknown(why string) error {
	return domain.TypedError{
		Code:    CodeOutcomeUnknown,
		Message: "Super Productivity may or may not have applied the change: " + why + ". Check the current state before retrying.",
	}
}

// uncertainOr reports OUTCOME_UNKNOWN for a mutation, whose answer could not
// be read, and code otherwise.
func uncertainOr(req Request, code, msg string, status int) error {
	if req.Mutation {
		return outcomeUnknown(fmt.Sprintf("its answer could not be read (HTTP %d)", status))
	}
	return domain.TypedError{Code: code, Message: msg, Details: map[string]any{"status": status}}
}

func decode(req Request, status int, raw []byte) (json.RawMessage, error) {
	if status >= 300 && status < 400 {
		return nil, domain.TypedError{Code: CodeRedirectRefused, Message: "Local REST answered with a redirect, which is not followed", Details: map[string]any{"status": status}}
	}
	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil || env.OK == nil {
		// Do not echo the body: it is not ours to show and may hold task data.
		if status >= 500 {
			return nil, uncertainOr(req, CodeFailed, "Local REST failed without a readable error", status)
		}
		if status >= 400 {
			return nil, domain.TypedError{Code: CodeFailed, Message: "Local REST rejected the request without a readable error", Details: map[string]any{"status": status}}
		}
		return nil, uncertainOr(req, CodeMalformedResponse, "Local REST answered without the {ok, data} envelope", status)
	}
	if *env.OK && status < 300 {
		return env.Data, nil
	}
	upstreamCode, upstreamMsg := "", ""
	if env.Error != nil {
		upstreamCode, upstreamMsg = env.Error.Code, truncate(env.Error.Message, maxUpstreamMessage)
	}
	if *env.OK || upstreamCode == "" {
		return nil, uncertainOr(req, CodeMalformedResponse, "Local REST answered with an inconsistent envelope", status)
	}
	details := map[string]any{"status": status, "upstreamCode": upstreamCode}
	te := func(code string, retryable bool, msg string) error {
		return domain.TypedError{Code: code, Message: msg, Retryable: retryable, Details: details}
	}
	switch {
	case status == http.StatusUnauthorized:
		return nil, te(CodeUnauthorized, false, "Local REST rejected the access token. Set SP_LOCAL_REST_TOKEN to the token in Settings → Misc → Access Token.")
	case upstreamCode == "API_DISABLED" || upstreamCode == "APP_NOT_READY" || status == http.StatusTooManyRequests:
		// Refused before the request reached the app's data.
		return nil, te(CodeUnavailable, true, "Local REST is not ready to take requests: "+upstreamMsg)
	case status == http.StatusNotFound && upstreamCode == "NOT_FOUND", status == http.StatusMethodNotAllowed:
		return nil, te(CodeUnsupportedRoute, false, "This Super Productivity version does not offer the Local REST route "+req.Method+" "+routeShape(req.Path)+". Check SP_LOCAL_REST_URL (stock v20 uses http://127.0.0.1:3876 without /api).")
	case status >= 500:
		if req.Mutation {
			return nil, outcomeUnknown("the app reported " + upstreamCode)
		}
		return nil, te(CodeFailed, true, "Local REST failed: "+upstreamMsg)
	case upstreamCode == "INVALID_INPUT" || upstreamCode == "INVALID_REQUEST_BODY":
		return nil, te(CodeInvalidRequest, false, upstreamMsg)
	default:
		return nil, te(upstreamCode, false, upstreamMsg)
	}
}

// routeShape replaces path segments after the resource name with ":id" so an
// error message never carries a caller-supplied identifier verbatim.
func routeShape(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) >= 2 {
		parts[1] = ":id"
	}
	return "/" + strings.Join(parts, "/")
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

// SegmentPath joins already-trusted literal segments with escaped values,
// for example SegmentPath("tasks", id, "archive").
func SegmentPath(segments ...string) string {
	var b strings.Builder
	for _, s := range segments {
		b.WriteByte('/')
		b.WriteString(url.PathEscape(s))
	}
	return b.String()
}
