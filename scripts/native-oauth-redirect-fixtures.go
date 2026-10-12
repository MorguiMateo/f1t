// Local reproduction of Supabase Auth redirect helper semantics (public code, no server calls).
// Reference: auth ce9a8eee0cc042be8c7a42981a7ddae631e41d91 verify.go and external.go.
package main

import (
	"encoding/json"
	"net/url"
	"os"
)

type Fixture struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	Code   string `json:"code,omitempty"`
	Reason string `json:"reason,omitempty"`
}

func main() {
	rows := []Fixture{}
	for _, redirect := range []string{"f1t://auth/callback", "f1t://auth/callback?sb_flow_id=fixture-flow&state=metadata", "f1t://auth/callback#"} {
		target, _ := url.Parse(redirect)
		q := target.Query()
		q.Set("code", "fixture-code")
		target.RawQuery = q.Encode()
		rows = append(rows, Fixture{Name: "Go PKCE success", URL: target.String(), Code: "fixture-code"})
	}
	// Go normalizes empty fragments away; the Swift SDK also ignores an empty browser-return fragment.
	rows = append(rows, Fixture{Name: "Swift-client-compatible terminal hash", URL: rows[0].URL + "#", Code: "fixture-code"})
	for _, failure := range []struct{ oauth, code, reason string }{{"access_denied", "", "accessDenied"}, {"server_error", "unexpected_failure", "providerUnavailable"}, {"access_denied", "signup_disabled", "signupDisabled"}} {
		target, _ := url.Parse("f1t://auth/callback")
		q := target.Query()
		q.Set("error", failure.oauth)
		q.Set("error_description", "private-fixture-must-not-be-printed@example.invalid")
		if failure.code != "" {
			q.Set("error_code", failure.code)
		}
		target.RawQuery = q.Encode()
		mirrored := url.Values{}
		for key, values := range q {
			mirrored[key] = values
		}
		mirrored.Set("sb", "")
		target.Fragment = mirrored.Encode()
		rows = append(rows, Fixture{Name: "Go mirrored provider error", URL: target.String(), Reason: failure.reason})
	}
	json.NewEncoder(os.Stdout).Encode(rows)
}
