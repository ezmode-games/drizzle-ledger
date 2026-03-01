import { defineConfig } from 'tsup';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		'soft-delete/index': 'src/soft-delete/index.ts',
		'soft-delete/sqlite': 'src/soft-delete/sqlite.ts',
		'soft-delete/pg': 'src/soft-delete/pg.ts',
		'soft-delete/mysql': 'src/soft-delete/mysql.ts',
		'schema/index': 'src/schema/index.ts',
		'schema/sqlite': 'src/schema/sqlite.ts',
		'schema/pg': 'src/schema/pg.ts',
		'schema/mysql': 'src/schema/mysql.ts',
		audit: 'src/audit.ts',
		context: 'src/context.ts',
		db: 'src/db.ts',
		gdpr: 'src/gdpr.ts',
		logger: 'src/logger.ts',
		'better-auth': 'src/better-auth.ts',
	},
	format: ['esm', 'cjs'],
	dts: true,
	clean: true,
	splitting: false,
	sourcemap: true,
	external: ['drizzle-orm', 'better-auth'],
});
