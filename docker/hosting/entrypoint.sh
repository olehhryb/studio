#!/bin/bash
set -e

mkdir -p \
  /home/deploy/public_html/site1 \
  /home/deploy/public_html/site2 \
  /home/deploy/public_html/site3 \
  /home/deploy/.ssh \
  /var/run/sshd \
  /var/lock/apache2 \
  /var/run/apache2
chown -R deploy:deploy /home/deploy
chown -R deploy:deploy /var/lock/apache2 /var/run/apache2 /var/log/apache2
chmod 755 /home/deploy /home/deploy/public_html
chmod 755 /home/deploy/public_html/site1 /home/deploy/public_html/site2 /home/deploy/public_html/site3

install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
if [ -f /etc/ssh/deploy.pub ]; then
  install -m 600 -o deploy -g deploy /etc/ssh/deploy.pub /home/deploy/.ssh/authorized_keys
fi

if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
  ssh-keygen -A
fi

/usr/sbin/sshd
exec apache2-foreground
