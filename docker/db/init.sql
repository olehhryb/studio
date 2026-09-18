-- Shared-hosting style: one MariaDB server, a separate database + user per site.
-- WordPress in each folder uses only its own database (like cPanel MySQL Databases).

CREATE DATABASE IF NOT EXISTS `site1` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS `site2` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS `site3` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'site1'@'%' IDENTIFIED BY 'site1pass';
CREATE USER IF NOT EXISTS 'site2'@'%' IDENTIFIED BY 'site2pass';
CREATE USER IF NOT EXISTS 'site3'@'%' IDENTIFIED BY 'site3pass';

GRANT ALL PRIVILEGES ON `site1`.* TO 'site1'@'%';
GRANT ALL PRIVILEGES ON `site2`.* TO 'site2'@'%';
GRANT ALL PRIVILEGES ON `site3`.* TO 'site3'@'%';

-- Account-level user (like a cPanel DB user assigned to all of this account's databases)
GRANT ALL PRIVILEGES ON `cpanel`.* TO 'wpuser'@'%';
GRANT ALL PRIVILEGES ON `site1`.* TO 'wpuser'@'%';
GRANT ALL PRIVILEGES ON `site2`.* TO 'wpuser'@'%';
GRANT ALL PRIVILEGES ON `site3`.* TO 'wpuser'@'%';

FLUSH PRIVILEGES;
