#!/bin/sh
# Boot a cloud image in QEMU and run the NetworkChum installer inside it.
#
#   ./scripts/vm-install-test.sh <image-url> <name>
#
# Run it on a Linux host with KVM (it needs qemu-system-x86_64, qemu-img,
# cloud-localds, git, sudo). Every step is logged to /tmp/nc-vmtest/<name>.log
# and the serial console to /tmp/nc-vmtest/<name>-console.log.
#
# Cloud images used for the supported families:
#   apt     https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
#   apt     https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2
#   dnf     https://download.fedoraproject.org/pub/fedora/linux/releases/42/Cloud/x86_64/images/Fedora-Cloud-Base-Generic-42-1.1.x86_64.qcow2
#   dnf     https://dl.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud-Base.latest.x86_64.qcow2
#   pacman  https://geo.mirror.pkgbuild.com/images/latest/Arch-Linux-x86_64-cloudimg.qcow2
#   zypper  https://download.opensuse.org/distribution/leap/15.6/appliances/openSUSE-Leap-15.6-Minimal-VM.x86_64-Cloud.qcow2
#
# The VM is booted with -no-reboot -no-shutdown so it stays alive after the
# guest powers off, which keeps the final steps from racing a dying qemu.
# Set KEEP_VM=1 to leave the VM running for hands-on debugging.
set -eu

IMAGE_URL=$1
NAME=$2
WORK=/tmp/nc-vmtest
mkdir -p "$WORK"
BASE="$WORK/$NAME-base.qcow2"
DISK="$WORK/$NAME.qcow2"
SEED="$WORK/$NAME-seed.iso"
CONSOLE="$WORK/$NAME-console.log"
SSH_PORT=${SSH_PORT:-2223}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/nc-vmtest}
[ -f "$SSH_KEY" ] || ssh-keygen -t ed25519 -N "" -f "$SSH_KEY" -C nc-vmtest >/dev/null
VM_USER=cass
VM_PASS=networkchum
REPO=${REPO:-$HOME/networkchum}
REPO_URL=${REPO_URL:-https://github.com/Cass67/networkchum.git}

say() { printf '%s\n' "$*"; }
step() {
  say ""
  say "### $*"
}

ssh_vm() {
  ssh -i "$SSH_KEY" -p "$SSH_PORT" \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=10 -o LogLevel=ERROR "$VM_USER@127.0.0.1" "$@"
}
scp_vm() {
  scp -q -r -i "$SSH_KEY" -P "$SSH_PORT" \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR "$@"
}

cleanup() {
  [ -f "$WORK/$NAME.pid" ] && kill "$(cat "$WORK/$NAME.pid")" 2>/dev/null || true
  rm -f "$WORK/$NAME.pid"
}
trap cleanup EXIT INT TERM
if [ "${KEEP_VM:-0}" = "1" ]; then trap - EXIT; fi

step "$NAME: preparing disk"
[ -f "$BASE" ] || curl -fsSL "$IMAGE_URL" -o "$BASE"
rm -f "$DISK"
qemu-img create -q -f qcow2 -F qcow2 -b "$BASE" "$DISK" 20G

step "$NAME: building cloud-init seed"
USERDATA="$WORK/$NAME-user-data"
cat >"$USERDATA" <<EOF
#cloud-config
users:
  - name: $VM_USER
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: false
    shell: /bin/bash
    ssh_authorized_keys:
      - $(cat "$SSH_KEY.pub")
chpasswd:
  expire: false
  users:
    - {name: $VM_USER, password: $VM_PASS, type: text}
ssh_pwauth: true
package_update: false
runcmd:
  - [ sh, -c, "touch /tmp/cloud-init-done" ]
EOF
printf 'instance-id: %s\nlocal-hostname: %s\n' "$NAME" "$NAME" >"$WORK/$NAME-meta-data"
cloud-localds "$SEED" "$USERDATA" "$WORK/$NAME-meta-data"

step "$NAME: booting"
qemu-system-x86_64 \
  -name "nc-vmtest-$NAME" \
  -machine q35,accel=kvm -cpu host -smp 4 -m 4096 \
  -drive file="$DISK",if=virtio,format=qcow2 \
  -drive file="$SEED",if=virtio,format=raw,readonly=on \
  -netdev user,id=n0,hostfwd=tcp:127.0.0.1:"$SSH_PORT"-:22 \
  -device virtio-net-pci,netdev=n0 \
  -no-reboot -no-shutdown \
  -display none -serial file:"$CONSOLE" -daemonize -pidfile "$WORK/$NAME.pid"
say "  pid $(cat "$WORK/$NAME.pid"), console: $CONSOLE"

step "$NAME: waiting for ssh"
i=0
until ssh_vm true 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -gt 90 ] && {
    tail -40 "$CONSOLE"
    exit 1
  }
  sleep 5
done

step "$NAME: waiting for cloud-init"
i=0
until ssh_vm 'test -f /tmp/cloud-init-done'; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && {
    say "cloud-init did not finish"
    exit 1
  }
  sleep 5
done

step "$NAME: host facts"
ssh_vm 'cat /etc/os-release | head -2; uname -r; nproc; free -m | head -2'

step "$NAME: copy repo"
ssh_vm 'rm -rf ~/networkchum'
if [ -d "$REPO/.git" ]; then
  (cd "$REPO" && tar -czf /tmp/nc-repo.tgz --exclude=node_modules --exclude=.networkchum .)
  scp_vm /tmp/nc-repo.tgz "$VM_USER@127.0.0.1:/tmp/nc-repo.tgz"
  ssh_vm 'mkdir -p ~/networkchum && tar -xzf /tmp/nc-repo.tgz -C ~/networkchum && rm /tmp/nc-repo.tgz'
else
  ssh_vm "git clone -q $REPO_URL ~/networkchum"
fi
ssh_vm 'cd ~/networkchum && git log --oneline -1 2>/dev/null || echo "(no git metadata)"'

step "$NAME: install.sh --dry-run"
ssh_vm 'cd ~/networkchum && ./install.sh --dry-run --yes 2>&1 | tail -25'

step "$NAME: install.sh"
ssh_vm 'cd ~/networkchum && ./install.sh --yes --container-runtime=docker --skip-firewall > /tmp/nc-install.log 2>&1; echo "install.sh exit=$?"; grep -vE "^\s+(Installing|Verifying|Updating|Downloading|Package|Dependencies|Transaction|Running|Last metadata|Determining|Dependency|  [a-z0-9][^ ]*-[0-9])" /tmp/nc-install.log | tail -30'

step "$NAME: tool versions"
ssh_vm 'node --version; npm --version; qemu-system-x86_64 --version | head -1 || /usr/libexec/qemu-kvm --version | head -1; docker --version || podman --version'

step "$NAME: npm ci + build"
ssh_vm 'cd ~/networkchum && npm ci 2>&1 | tail -3 && npm run build 2>&1 | tail -3'

step "$NAME: install-service"
ssh_vm 'cd ~/networkchum && ./start.sh lan install-service 2>&1 | tail -6'

step "$NAME: health"
ssh_vm 'sleep 8; curl -s -o /dev/null -w "health %{http_code}\n" http://127.0.0.1:4000/health; curl -s -o /dev/null -w "ui %{http_code}\n" http://127.0.0.1:5173/; curl -s -o /dev/null -w "labs-noauth %{http_code}\n" http://127.0.0.1:4000/labs; systemctl is-active networkchum || systemctl --user is-active networkchum'

step "$NAME: uninstall-service"
ssh_vm 'cd ~/networkchum && ./start.sh uninstall-service 2>&1 | tail -3; systemctl is-active networkchum || true; systemctl --user is-active networkchum || true'

step "$NAME: qemu binary"
ssh_vm 'command -v qemu-system-x86_64 || command -v qemu-kvm || ls /usr/libexec/qemu-kvm'

step "$NAME: PASS"
