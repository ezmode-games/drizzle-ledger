import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		setupFiles: ['./test/setup.ts'],
	},
	resolve: {
		alias: {
			'drizzle-ledger/soft-delete/sqlite': './src/soft-delete/sqlite.ts',
			'drizzle-ledger/soft-delete/pg': './src/soft-delete/pg.ts',
			'drizzle-ledger/soft-delete/mysql': './src/soft-delete/mysql.ts',
			'drizzle-ledger/soft-delete': './src/soft-delete/index.ts',
			'drizzle-ledger/schema/sqlite': './src/schema/sqlite.ts',
			'drizzle-ledger/schema/pg': './src/schema/pg.ts',
			'drizzle-ledger/schema/mysql': './src/schema/mysql.ts',
			'drizzle-ledger/schema': './src/schema/index.ts',
			'drizzle-ledger/audit': './src/audit.ts',
			'drizzle-ledger/context': './src/context.ts',
			'drizzle-ledger/db': './src/db.ts',
			'drizzle-ledger/gdpr': './src/gdpr.ts',
			'drizzle-ledger/logger': './src/logger.ts',
			'drizzle-ledger/better-auth': './src/better-auth.ts',
			'drizzle-ledger': './src/index.ts',
		},
	},
});
