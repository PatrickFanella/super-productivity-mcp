package config

import (
	"reflect"
	"testing"
)

func TestParseScopes(t *testing.T) {
	cases := []struct {
		raw         string
		wantScopes  []string
		wantInvalid []string
	}{
		{"", AllScopes, nil},
		{"   ", AllScopes, nil},
		{"all", AllScopes, nil},
		{"read", []string{"read"}, nil},
		{"write, READ ,read", []string{"read", "write"}, nil},
		{"read,bogus", []string{"read"}, []string{"bogus"}},
		// Fails closed: nothing valid means nothing but the status tools.
		{"bogus", nil, []string{"bogus"}},
	}
	for _, c := range cases {
		scopes, invalid := parseScopes(c.raw)
		if !reflect.DeepEqual(scopes, c.wantScopes) || !reflect.DeepEqual(invalid, c.wantInvalid) {
			t.Errorf("parseScopes(%q) = %v, %v; want %v, %v", c.raw, scopes, invalid, c.wantScopes, c.wantInvalid)
		}
	}
}

func TestLoadLocalRESTSettings(t *testing.T) {
	t.Setenv("SP_LOCAL_REST_URL", "")
	t.Setenv("SUPER_PRODUCTIVITY_REST_URL", " http://127.0.0.1:3876 ")
	t.Setenv("SP_LOCAL_REST_TOKEN", " tok ")
	t.Setenv("SP_LOCAL_REST_ALLOW_REMOTE", "true")
	t.Setenv("SP_LOCAL_REST_TIMEOUT", "5s")
	cfg := Load()
	if cfg.LocalRESTURL != "http://127.0.0.1:3876" || cfg.LocalRESTToken != "tok" || !cfg.LocalRESTAllowRemote || cfg.LocalRESTTimeout.String() != "5s" {
		t.Fatalf("unexpected REST settings: %+v", cfg)
	}

	// SP_LOCAL_REST_URL wins over the alias and is kept as written.
	t.Setenv("SP_LOCAL_REST_URL", "http://127.0.0.1:4767/api")
	t.Setenv("SP_LOCAL_REST_ALLOW_REMOTE", "")
	t.Setenv("SP_LOCAL_REST_TIMEOUT", "bogus")
	cfg = Load()
	if cfg.LocalRESTURL != "http://127.0.0.1:4767/api" || cfg.LocalRESTAllowRemote || cfg.LocalRESTTimeout != 0 {
		t.Fatalf("unexpected REST settings: %+v", cfg)
	}
}
