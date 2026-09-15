# Clay DNS

Clay uses a [sslip.io](https://github.com/cunnie/sslip.io)-style DNS server to provide browser-trusted HTTPS without any user setup.

## How it works

When Clay starts, it generates a URL like `https://192-168-1-50.d.clay.studio:2633`. The DNS server parses the IP from the subdomain and returns it as the DNS response. Combined with a wildcard Let's Encrypt certificate for `*.d.clay.studio`, this gives every Clay user valid HTTPS on their local network with zero configuration.

```
Browser: "What is 192-168-1-50.d.clay.studio?"
DNS:     "192.168.1.50"
Browser:  Connects to 192.168.1.50 on LAN
Server:   Presents *.d.clay.studio certificate
Browser:  Valid cert, no warnings
```

Traffic never leaves the local network. Only the DNS query goes to the internet.

## Self-hosting

If you want to run your own DNS server for a custom domain, here's how.

### Prerequisites

- A VM with a public IP (any cloud provider, even free tier)
- A domain you own
- Ubuntu 22.04+ (or any Linux)

### 1. Build sslip.io

```bash
sudo apt-get update && sudo apt-get install -y golang-go git
git clone https://github.com/cunnie/sslip.io.git
cd sslip.io
go build -o /usr/local/bin/sslip-dns .
```

### 2. Create systemd service

```ini
# /etc/systemd/system/clay-dns.service
[Unit]
Description=Clay DNS Server (sslip.io)
After=network.target

[Service]
ExecStart=/usr/local/bin/sslip-dns
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable clay-dns
sudo systemctl start clay-dns
```

### 3. Open firewall

```bash
# OS-level firewall
sudo iptables -I INPUT -p udp --dport 53 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 53 -j ACCEPT
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

If your cloud provider has a separate security group/list, open UDP 53 and TCP 53 there too.

### 4. Configure DNS records

At your domain registrar:

1. **Register a personal nameserver** (glue record):
   - `ns1.yourdomain.com` pointing to your VM's public IP

2. **Add an A record**:
   - Host: `ns1`, Value: your VM's public IP

3. **Add an NS record**:
   - Host: `d` (or your chosen subdomain), Value: `ns1.yourdomain.com.`

### 5. Verify

```bash
dig 192-168-1-50.d.yourdomain.com +short
# Should return: 192.168.1.50
```

## Wildcard certificate

To issue a `*.d.yourdomain.com` Let's Encrypt certificate via DNS-01 challenge, the ACME TXT record query will route to your DNS server (since `d.yourdomain.com` is NS-delegated). You need your DNS server to respond to `_acme-challenge` TXT queries during issuance.

A simple approach: temporarily run a Python DNS server that handles both IP parsing and ACME TXT responses.

```python
# acme-dns.py
import re, sys, socket
from dnslib import DNSRecord, RR, QTYPE, A, TXT

CHALLENGE = sys.argv[1] if len(sys.argv) > 1 else ''

def parse_ip(name):
    m = re.search(r'(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})', name)
    if m:
        ip = '.'.join(m.groups())
        if all(0 <= int(x) <= 255 for x in m.groups()):
            return ip
    return None

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(('0.0.0.0', 53))

while True:
    data, addr = sock.recvfrom(512)
    try:
        request = DNSRecord.parse(data)
        qname = str(request.q.qname).lower()
        qtype = request.q.qtype
        reply = request.reply()

        if '_acme-challenge' in qname and qtype == QTYPE.TXT and CHALLENGE:
            reply.add_answer(RR(request.q.qname, QTYPE.TXT, rdata=TXT(CHALLENGE), ttl=60))
        elif qtype == QTYPE.A:
            ip = parse_ip(qname)
            if ip:
                reply.add_answer(RR(request.q.qname, QTYPE.A, rdata=A(ip), ttl=300))

        sock.sendto(reply.pack(), addr)
    except:
        pass
```

### Certificate issuance flow

```bash
# Install deps
sudo apt-get install -y certbot python3-dnslib

# Create certbot hook
cat > /usr/local/bin/acme-auth.sh << 'EOF'
#!/bin/bash
kill $(pgrep -f acme-dns.py) 2>/dev/null
sleep 1
python3 /path/to/acme-dns.py "$CERTBOT_VALIDATION" > /tmp/acme-dns.log 2>&1 &
sleep 5
EOF
chmod +x /usr/local/bin/acme-auth.sh

# Stop the main DNS server, run certbot
sudo systemctl stop clay-dns
sudo certbot certonly --manual --preferred-challenges dns \
  -d '*.d.yourdomain.com' \
  --agree-tos --email you@example.com --no-eff-email \
  --manual-auth-hook /usr/local/bin/acme-auth.sh \
  --manual-cleanup-hook 'echo done'

# Restart main DNS server
sudo systemctl start clay-dns
```

## License

The DNS server itself is [sslip.io](https://github.com/cunnie/sslip.io), licensed under Apache 2.0. Clay-owned setup material is licensed under the [GNU Affero General Public License, version 3 only](../LICENSE) (AGPL-3.0-only). Preexisting MIT-covered portions retain their original grants; see [LICENSES/README.md](../LICENSES/README.md).
