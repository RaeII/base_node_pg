# 002 — Hardening do Ubuntu

Preparação do servidor **antes** de qualquer deploy. Objetivo: reduzir superfície de ataque do sistema operacional. Tudo aqui vale para Ubuntu 22.04/24.04 LTS.

---

## 1. Usuários e privilégios

Nunca opere como `root` e nunca rode a aplicação com o usuário que faz deploy.

```bash
# Usuário de administração (login SSH, tem sudo)
adduser deploy
usermod -aG sudo deploy

# Usuário de serviço da aplicação (SEM sudo, SEM login)
sudo adduser --system --group --home /var/www --shell /usr/sbin/nologin nodeapp
```

- `deploy`: entra por SSH, faz deploy, administra.
- `nodeapp`: dono do processo da aplicação (usado no systemd em [003](003-aplicacao-producao.md)). Se a app for comprometida, o atacante não tem shell nem sudo.

## 2. SSH

Edite `/etc/ssh/sshd_config` (ou um drop-in em `/etc/ssh/sshd_config.d/99-hardening.conf`):

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers deploy
MaxAuthTries 3
LoginGraceTime 20
X11Forwarding no
```

```bash
# Antes de aplicar: garanta que sua chave pública está em /home/deploy/.ssh/authorized_keys
# e teste login por chave em OUTRA sessão antes de fechar a atual.
sudo systemctl restart ssh
```

- **Só chave pública.** Senha em SSH exposto à internet = brute-force constante.
- Trocar a porta (ex.: 2222) reduz ruído de scanner, mas **não é segurança** — fail2ban e chave são o que protege.

## 3. Firewall (UFW)

Política: **negar tudo que entra, liberar só o necessário**. A aplicação (porta 3000) e o PostgreSQL (5432) ficam automaticamente inacessíveis de fora — só o nginx fala com a app.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing

sudo ufw allow OpenSSH        # ou "sudo ufw allow 2222/tcp" se mudou a porta
sudo ufw limit OpenSSH        # rate limit nativo: bloqueia IP com 6+ conexões em 30s
sudo ufw allow 80/tcp         # HTTP (só para redirect + challenge do certbot)
sudo ufw allow 443/tcp        # HTTPS

sudo ufw enable
sudo ufw status verbose
```

> **Nunca** libere 3000 (app) nem 5432 (PostgreSQL) no UFW. Se precisar acessar o banco remotamente, use túnel SSH: `ssh -L 5432:localhost:5432 deploy@servidor`.

> **Docker fura o UFW**: se rodar a app via Docker com `-p 3000:3000`, o Docker escreve direto no iptables e ignora o UFW. Publique portas apenas em localhost: `-p 127.0.0.1:3000:3000`.

## 4. fail2ban

Bane IPs com comportamento de ataque (brute-force SSH, flood no nginx — jails do nginx em [005](005-protecao-ddos-e-abuso.md)).

```bash
sudo apt install fail2ban
```

`/etc/fail2ban/jail.local`:

```ini
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
# aumenta o ban a cada reincidência
bantime.increment = true
bantime.maxtime   = 48h

[sshd]
enabled = true
```

```bash
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd    # ver IPs banidos
```

## 5. Atualizações automáticas de segurança

```bash
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # responda "Yes"
```

Confirme em `/etc/apt/apt.conf.d/50unattended-upgrades` que `${distro_id}:${distro_codename}-security` está ativo. Patches de segurança do SO aplicados sem intervenção — a maioria das invasões usa vulnerabilidade **antiga** já corrigida.

Opcional (reboot automático de madrugada quando kernel exigir):

```
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
```

> Com reboot automático, a app precisa voltar sozinha — garantido pelo `systemctl enable` do serviço em [003](003-aplicacao-producao.md).

## 6. Kernel / sysctl

Ubuntu já vem com defaults razoáveis. Estes ajustes ajudam sob carga e contra SYN flood. Crie `/etc/sysctl.d/99-hardening.conf`:

```ini
# --- Rede: resiliência a flood ---
net.ipv4.tcp_syncookies = 1            # sobrevive a SYN flood sem esgotar backlog
net.ipv4.tcp_max_syn_backlog = 4096
net.core.somaxconn = 4096              # fila de accept() maior (nginx + app sob pico)
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_slow_start_after_idle = 0

# --- Rede: anti-spoofing ---
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0

# --- ICMP ---
net.ipv4.icmp_echo_ignore_broadcasts = 1
```

```bash
sudo sysctl --system
```

## 7. Limites de arquivo (file descriptors)

Cada conexão TCP consome um file descriptor. Default de 1024 derruba a app em pico de tráfego com erro `EMFILE`.

- Para o **serviço systemd** da app: `LimitNOFILE=65536` na unit (já incluído em [003](003-aplicacao-producao.md)) — é o que vale para o processo.
- Para o nginx: `worker_rlimit_nofile 65536;` no `nginx.conf` (ver [004](004-nginx-proxy-tls.md)).

## 8. Miscelânea

```bash
# Relógio sincronizado (JWT `exp`, logs, TLS dependem disso)
timedatectl set-ntp true

# Swap modesto evita OOM-kill em picos de memória (VPS pequena)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Remova o que não usa (cada serviço escutando é superfície de ataque)
ss -tlnp    # audite: só deve haver sshd, nginx e (localhost) app + postgres
```

---

**Próximo:** [003 — Aplicação em produção](003-aplicacao-producao.md)
