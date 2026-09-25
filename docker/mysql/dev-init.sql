-- Local development only: extra databases for `prisma migrate dev` and the integration tests.
CREATE DATABASE IF NOT EXISTS ipt_pm_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS ipt_pm_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON ipt_pm_shadow.* TO 'ipt_pm'@'%';
GRANT ALL PRIVILEGES ON ipt_pm_test.* TO 'ipt_pm'@'%';
