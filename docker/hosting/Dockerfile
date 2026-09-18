FROM php:8.2-apache

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server \
    default-mysql-client \
    curl \
    wget \
    unzip \
    git \
    less \
    sudo \
    libpng-dev \
    libjpeg62-turbo-dev \
    libfreetype6-dev \
    libwebp-dev \
    libzip-dev \
    libicu-dev \
    libonig-dev \
    libxml2-dev \
  && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
  && docker-php-ext-install -j$(nproc) mysqli pdo_mysql gd zip intl exif opcache mbstring soap \
  && a2enmod rewrite headers \
  && curl -fsSL -o /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar \
  && chmod +x /usr/local/bin/wp \
  && useradd -m -s /bin/bash -u 1000 deploy \
  && echo 'deploy:deploypass' | chpasswd \
  && mkdir -p /home/deploy/public_html /home/deploy/.ssh /var/run/sshd \
  && chown -R deploy:deploy /home/deploy \
  && echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy \
  && sed -i 's/APACHE_RUN_USER=www-data/APACHE_RUN_USER=deploy/' /etc/apache2/envvars \
  && sed -i 's/APACHE_RUN_GROUP=www-data/APACHE_RUN_GROUP=deploy/' /etc/apache2/envvars \
  && rm -rf /var/lib/apt/lists/*

COPY sshd_config /etc/ssh/sshd_config
COPY apache-vhost.conf /etc/apache2/sites-available/000-default.conf
COPY php.ini /usr/local/etc/php/conf.d/cpanel.ini
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh /etc/ssh/sshd_config \
  && chmod +x /entrypoint.sh

EXPOSE 22 80

ENTRYPOINT ["/entrypoint.sh"]
