package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func str(value string) *string { return &value }
func num(value int) *int       { return &value }

func noBinaries(string) bool  { return false }
func allBinaries(string) bool { return true }

func TestBuildNativeCommand(t *testing.T) {
	tests := []struct {
		name     string
		payload  payload
		binaries func(string) bool
		want     string
	}{
		{
			name:     "socat for a local telnet target",
			payload:  payload{Terminal: "iterm", Host: str("127.0.0.1"), Port: num(5000)},
			binaries: allBinaries,
			want:     "socat STDIO,rawer,echo=0 TCP:127.0.0.1:5000",
		},
		{
			name:     "nc fallback",
			payload:  payload{Terminal: "iterm", Host: str("127.0.0.1"), Port: num(5004)},
			binaries: noBinaries,
			want:     "/usr/bin/nc 127.0.0.1 5004",
		},
		{
			name:     "ssh relay",
			payload:  payload{Terminal: "iterm", Host: str("localhost"), Port: num(5000), RelayHost: "192.168.2.1", RelayUser: "cass"},
			binaries: allBinaries,
			want:     "ssh -t cass@192.168.2.1 'socat STDIO,rawer,echo=0 TCP:localhost:5000'",
		},
		{
			name:     "docker exec",
			payload:  payload{Terminal: "iterm", ExecCommand: []string{"docker", "exec", "-it", "abc", "sh"}},
			binaries: allBinaries,
			want:     "docker exec -it abc sh",
		},
		{
			name:     "custom template",
			payload:  payload{Terminal: "custom", Host: str("127.0.0.1"), Port: num(5000), Template: "tmux new -s console {host}:{port}"},
			binaries: allBinaries,
			want:     "tmux new -s console 127.0.0.1:5000",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := buildNativeCommand(test.payload, test.binaries)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}

func TestBuildNativeCommandRejectsInvalidPayloads(t *testing.T) {
	invalid := []payload{
		{Terminal: "iterm"},
		{Terminal: "iterm", Host: str("10.0.0.1"), Port: num(5000)},
		{Terminal: "iterm", Host: str("127.0.0.1"), Port: num(70000)},
		{Terminal: "iterm", ExecCommand: []string{"bash", "-c", "rm -rf /"}},
		{Terminal: "unknown", Host: str("127.0.0.1"), Port: num(5000)},
		{Terminal: "custom", Host: str("127.0.0.1"), Port: num(5000), Template: "no placeholders"},
	}
	for _, payload := range invalid {
		if _, err := buildNativeCommand(payload, allBinaries); err == nil {
			t.Fatalf("expected an error for %+v", payload)
		}
	}
}

func TestBuildLaunchSpec(t *testing.T) {
	darwin, err := buildLaunchSpec("ssh -t host 'cmd'", "darwin", "iterm", allBinaries)
	if err != nil || darwin.Command != "/usr/bin/osascript" {
		t.Fatalf("darwin spec: %+v %v", darwin, err)
	}

	linux, err := buildLaunchSpec("cmd", "linux", "iterm", allBinaries)
	if err != nil || linux.Command != "x-terminal-emulator" {
		t.Fatalf("linux spec: %+v %v", linux, err)
	}

	windows, err := buildLaunchSpec("ssh -t host 'cmd'", "windows", "iterm", allBinaries)
	if err != nil || windows.Command != "cmd.exe" {
		t.Fatalf("windows spec: %+v %v", windows, err)
	}
	if strings.Join(windows.Args, " ") != "/c start  cmd /k ssh -t host 'cmd'" {
		t.Fatalf("unexpected windows args: %v", windows.Args)
	}

	if _, err := buildLaunchSpec("cmd", "freebsd", "iterm", allBinaries); err == nil {
		t.Fatal("expected an unsupported platform error")
	}
}

func TestServerHealthAndOpenConsole(t *testing.T) {
	var launched launchSpec
	handler := newServer(func(spec launchSpec) error {
		launched = spec
		return nil
	}, allBinaries, "darwin")

	health := httptest.NewRecorder()
	handler.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/health", nil))
	if health.Code != http.StatusOK || !strings.Contains(health.Body.String(), `"ok":true`) {
		t.Fatalf("health: %d %s", health.Code, health.Body.String())
	}

	body := `{"terminal":"iterm","host":"127.0.0.1","port":5000,"relayHost":"192.168.2.1"}`
	open := httptest.NewRecorder()
	handler.ServeHTTP(open, httptest.NewRequest(http.MethodPost, "/open-console", strings.NewReader(body)))
	if open.Code != http.StatusOK {
		t.Fatalf("open-console: %d %s", open.Code, open.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(open.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response["command"] != "ssh -t 192.168.2.1 'socat STDIO,rawer,echo=0 TCP:127.0.0.1:5000'" {
		t.Fatalf("unexpected command: %v", response["command"])
	}
	if launched.Command != "/usr/bin/osascript" {
		t.Fatalf("launcher not called: %+v", launched)
	}

	bad := httptest.NewRecorder()
	handler.ServeHTTP(bad, httptest.NewRequest(http.MethodPost, "/open-console", strings.NewReader(`{"terminal":"iterm"}`)))
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", bad.Code)
	}
}
