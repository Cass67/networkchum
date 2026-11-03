// NetworkChum native console bridge.
//
// A tiny local HTTP helper that opens a terminal window on the machine running
// the browser. Mirrors tools/native-console-bridge/server.js (which ships with
// the app for same-host use); this Go build is what we publish as a standalone
// client binary.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
)

const (
	bridgeHost = "127.0.0.1"
	bridgePort = 4010
)

var version = "dev"

var (
	safeToken  = regexp.MustCompile(`^[A-Za-z0-9._/:=@%+,-]+$`)
	relayToken = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
)

type payload struct {
	Terminal    string   `json:"terminal"`
	Host        *string  `json:"host"`
	Port        *int     `json:"port"`
	RelayHost   string   `json:"relayHost"`
	RelayUser   string   `json:"relayUser"`
	Template    string   `json:"template"`
	ExecCommand []string `json:"execCommand"`
}

func hasBinary(name string) bool {
	for _, dir := range strings.Split(os.Getenv("PATH"), string(os.PathListSeparator)) {
		if dir == "" {
			continue
		}
		if info, err := os.Stat(dir + string(os.PathSeparator) + name); err == nil && !info.IsDir() {
			return true
		}
	}
	return false
}

func validate(p payload) error {
	if p.Terminal != "iterm" && p.Terminal != "terminal-app" && p.Terminal != "custom" {
		return errors.New("unsupported terminal")
	}
	if p.RelayHost != "" && !relayToken.MatchString(p.RelayHost) {
		return errors.New("invalid relay host")
	}
	if p.RelayUser != "" && !relayToken.MatchString(p.RelayUser) {
		return errors.New("invalid relay user")
	}

	hasTelnet := p.Host != nil && p.Port != nil
	hasExec := len(p.ExecCommand) > 0
	if hasTelnet == hasExec {
		return errors.New("invalid console target")
	}
	if hasTelnet {
		if *p.Host != "127.0.0.1" && *p.Host != "localhost" {
			return errors.New("unsupported host")
		}
		if *p.Port < 1 || *p.Port > 65535 {
			return errors.New("invalid port")
		}
	}
	if hasExec {
		if len(p.ExecCommand) < 2 || (p.ExecCommand[0] != "docker" && p.ExecCommand[0] != "podman") {
			return errors.New("invalid exec command")
		}
		for _, token := range p.ExecCommand {
			if !safeToken.MatchString(token) {
				return errors.New("invalid exec command")
			}
		}
	}
	return nil
}

func shellSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

func shellWord(value string) string {
	if safeToken.MatchString(value) {
		return value
	}
	return shellSingleQuote(value)
}

func shellJoin(tokens []string) string {
	words := make([]string, 0, len(tokens))
	for _, token := range tokens {
		words = append(words, shellWord(token))
	}
	return strings.Join(words, " ")
}

func buildNativeCommand(p payload, binaryAvailable func(string) bool) (string, error) {
	if err := validate(p); err != nil {
		return "", err
	}

	var command string
	hasExec := len(p.ExecCommand) > 0

	switch {
	case p.Terminal == "custom" && hasExec:
		if !strings.Contains(p.Template, "{command}") {
			return "", errors.New("invalid custom terminal template")
		}
		command = strings.ReplaceAll(p.Template, "{command}", shellJoin(p.ExecCommand))
	case p.Terminal == "custom":
		if !strings.Contains(p.Template, "{host}") || !strings.Contains(p.Template, "{port}") {
			return "", errors.New("invalid custom terminal template")
		}
		command = strings.ReplaceAll(p.Template, "{host}", *p.Host)
		command = strings.ReplaceAll(command, "{port}", fmt.Sprintf("%d", *p.Port))
	case hasExec:
		command = shellJoin(p.ExecCommand)
	case binaryAvailable("socat"):
		command = fmt.Sprintf("socat STDIO,rawer,echo=0 TCP:%s:%d", *p.Host, *p.Port)
	default:
		command = fmt.Sprintf("/usr/bin/nc %s %d", *p.Host, *p.Port)
	}

	if p.RelayHost != "" {
		target := p.RelayHost
		if p.RelayUser != "" {
			target = p.RelayUser + "@" + p.RelayHost
		}
		return fmt.Sprintf("ssh -t %s %s", target, shellSingleQuote(command)), nil
	}
	return command, nil
}

type launchSpec struct {
	Command string
	Args    []string
}

func buildLaunchSpec(command, platform, terminal string, binaryAvailable func(string) bool) (launchSpec, error) {
	switch platform {
	case "darwin":
		if terminal == "terminal-app" {
			return launchSpec{
				Command: "/usr/bin/osascript",
				Args: []string{
					"-e", `tell application "Terminal" to activate`,
					"-e", "tell application \"Terminal\" to do script " + quoteJSON(command),
				},
			}, nil
		}
		return launchSpec{
			Command: "/usr/bin/osascript",
			Args: []string{
				"-e", `tell application "iTerm" to activate`,
				"-e", `tell application "iTerm" to create window with default profile`,
				"-e", `tell application "iTerm" to tell current session of current window to write text ` + quoteJSON(command),
			},
		}, nil
	case "linux":
		candidates := []string{"x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"}
		for _, candidate := range candidates {
			if !binaryAvailable(candidate) {
				continue
			}
			if candidate == "gnome-terminal" {
				return launchSpec{Command: candidate, Args: []string{"--", "sh", "-lc", command}}, nil
			}
			return launchSpec{Command: candidate, Args: []string{"-e", "sh", "-lc", command}}, nil
		}
		return launchSpec{}, errors.New("no supported terminal launcher found")
	case "windows":
		return launchSpec{Command: "cmd.exe", Args: []string{"/c", "start", "", "cmd", "/k", command}}, nil
	default:
		return launchSpec{}, fmt.Errorf("unsupported platform: %s", platform)
	}
}

func quoteJSON(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func launch(spec launchSpec) error {
	cmd := exec.Command(spec.Command, spec.Args...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil
	return cmd.Start()
}

type server struct {
	launcher        func(launchSpec) error
	binaryAvailable func(string) bool
	platform        string
}

func (s server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "content-type")

	if r.Method == http.MethodOptions && r.URL.Path == "/open-console" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method == http.MethodGet && r.URL.Path == "/health" {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"version":"` + version + `"}`))
		return
	}
	if r.Method != http.MethodPost || r.URL.Path != "/open-console" {
		http.NotFound(w, r)
		return
	}

	var body payload
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, errors.New("invalid payload"))
		return
	}
	command, err := buildNativeCommand(body, s.binaryAvailable)
	if err != nil {
		writeError(w, err)
		return
	}
	spec, err := buildLaunchSpec(command, s.platform, body.Terminal, s.binaryAvailable)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.launcher(spec); err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "command": command})
}

func writeError(w http.ResponseWriter, err error) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
}

func newServer(launcher func(launchSpec) error, binaryAvailable func(string) bool, platform string) http.Handler {
	return server{launcher: launcher, binaryAvailable: binaryAvailable, platform: platform}
}

func main() {
	fmt.Printf("NetworkChum console bridge %s listening on http://%s:%d\n", version, bridgeHost, bridgePort)
	handler := newServer(launch, hasBinary, runtime.GOOS)
	if err := http.ListenAndServe(fmt.Sprintf("%s:%d", bridgeHost, bridgePort), handler); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
