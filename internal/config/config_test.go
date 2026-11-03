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
