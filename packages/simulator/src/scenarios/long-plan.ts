import type { Scenario } from '../types.js';
import * as h from '../helpers.js';

export const longPlan: Scenario = {
  name: 'long-plan',
  description: '6-step plan with sub-agents and growing token usage',
  projectPath: '/tmp/hudai-sim-project',
  timeline: [
    {
      delay: 500,
      label: '💬 User prompt',
      entries: [h.userPrompt('Refactor the database layer to use the repository pattern')],
    },

    // Think + create plan
    {
      delay: 2500,
      label: '📋 Creating 6-step plan',
      entries: [
        h.assistantMessage([
          h.thinking('This is a significant refactoring. I need to: 1) Analyze current DB usage, 2) Create interfaces, 3-4) Implement repos, 5) Update services, 6) Add tests.'),
          h.todoWrite([
            { content: 'Analyze current database usage patterns', status: 'in_progress' },
            { content: 'Create repository interfaces', status: 'pending' },
            { content: 'Implement UserRepository', status: 'pending' },
            { content: 'Implement PostRepository', status: 'pending' },
            { content: 'Update service layer to use repositories', status: 'pending' },
            { content: 'Add integration tests', status: 'pending' },
          ]),
        ], { inputTokens: 8000, outputTokens: 2000 }),
      ],
    },

    // Step 1: Analyze — multiple reads + grep
    {
      delay: 2000,
      label: '🔍 Step 1: Analyzing DB usage',
      entries: [
        h.assistantMessage([
          h.readFile('src/db/pool.ts'),
          h.readFile('src/services/user-service.ts'),
          h.readFile('src/services/post-service.ts'),
          h.grep('db\\.query|pool\\.query'),
        ], { inputTokens: 15000, outputTokens: 1200 }),
      ],
    },

    // Spawn sub-agent for deeper analysis
    {
      delay: 2000,
      label: '🤖 Spawning Explore sub-agent',
      entries: (() => {
        const agentTool = h.subagent('Find all database query patterns and their return types across the codebase', 'Explore');
        return [
          h.assistantMessage([agentTool], { inputTokens: 18000, outputTokens: 500 }),
        ];
      })(),
    },

    // Sub-agent returns + advance plan
    {
      delay: 3000,
      label: '📋 Step 1 done → Step 2',
      entries: [
        h.assistantMessage([
          h.todoWrite([
            { content: 'Analyze current database usage patterns', status: 'completed' },
            { content: 'Create repository interfaces', status: 'in_progress' },
            { content: 'Implement UserRepository', status: 'pending' },
            { content: 'Implement PostRepository', status: 'pending' },
            { content: 'Update service layer to use repositories', status: 'pending' },
            { content: 'Add integration tests', status: 'pending' },
          ]),
          h.writeFile('src/repositories/types.ts', [
            'export interface IUserRepository {',
            '  findById(id: string): Promise<User | null>;',
            '  findByEmail(email: string): Promise<User | null>;',
            '  create(data: CreateUserInput): Promise<User>;',
            '  update(id: string, data: Partial<User>): Promise<User>;',
            '  delete(id: string): Promise<void>;',
            '}',
            '',
            'export interface IPostRepository {',
            '  findById(id: string): Promise<Post | null>;',
            '  findByAuthor(authorId: string): Promise<Post[]>;',
            '  create(data: CreatePostInput): Promise<Post>;',
            '  update(id: string, data: Partial<Post>): Promise<Post>;',
            '  delete(id: string): Promise<void>;',
            '}',
          ].join('\n')),
        ], { inputTokens: 25000, outputTokens: 3000 }),
      ],
    },

    // Step 3: Implement UserRepository
    {
      delay: 2500,
      label: '✏️  Step 3: UserRepository',
      entries: [
        h.assistantMessage([
          h.todoWrite([
            { content: 'Analyze current database usage patterns', status: 'completed' },
            { content: 'Create repository interfaces', status: 'completed' },
            { content: 'Implement UserRepository', status: 'in_progress' },
            { content: 'Implement PostRepository', status: 'pending' },
            { content: 'Update service layer to use repositories', status: 'pending' },
            { content: 'Add integration tests', status: 'pending' },
          ]),
          h.writeFile('src/repositories/user-repository.ts', [
            'import { Pool } from "pg";',
            'import { IUserRepository } from "./types";',
            '',
            'export class UserRepository implements IUserRepository {',
            '  constructor(private pool: Pool) {}',
            '  async findById(id: string) { return this.pool.query("SELECT * FROM users WHERE id = $1", [id]).then(r => r.rows[0]); }',
            '  async findByEmail(email: string) { return this.pool.query("SELECT * FROM users WHERE email = $1", [email]).then(r => r.rows[0]); }',
            '  async create(data: any) { /* ... */ }',
            '  async update(id: string, data: any) { /* ... */ }',
            '  async delete(id: string) { /* ... */ }',
            '}',
          ].join('\n')),
        ], { inputTokens: 35000, outputTokens: 2500 }),
      ],
    },

    // Step 4: Implement PostRepository
    {
      delay: 2000,
      label: '✏️  Step 4: PostRepository',
      entries: [
        h.assistantMessage([
          h.todoWrite([
            { content: 'Analyze current database usage patterns', status: 'completed' },
            { content: 'Create repository interfaces', status: 'completed' },
            { content: 'Implement UserRepository', status: 'completed' },
            { content: 'Implement PostRepository', status: 'in_progress' },
            { content: 'Update service layer to use repositories', status: 'pending' },
            { content: 'Add integration tests', status: 'pending' },
          ]),
          h.writeFile('src/repositories/post-repository.ts', [
            'import { Pool } from "pg";',
            'import { IPostRepository } from "./types";',
            '',
            'export class PostRepository implements IPostRepository {',
            '  constructor(private pool: Pool) {}',
            '  async findById(id: string) { /* ... */ }',
            '  async findByAuthor(authorId: string) { /* ... */ }',
            '  async create(data: any) { /* ... */ }',
            '  async update(id: string, data: any) { /* ... */ }',
            '  async delete(id: string) { /* ... */ }',
            '}',
          ].join('\n')),
        ], { inputTokens: 45000, outputTokens: 2000 }),
      ],
    },

    // Step 5: Update services
    {
      delay: 2500,
      label: '✏️  Step 5: Updating service layer',
      entries: [
        h.assistantMessage([
          h.todoWrite([
            { content: 'Analyze current database usage patterns', status: 'completed' },
            { content: 'Create repository interfaces', status: 'completed' },
            { content: 'Implement UserRepository', status: 'completed' },
            { content: 'Implement PostRepository', status: 'completed' },
            { content: 'Update service layer to use repositories', status: 'in_progress' },
            { content: 'Add integration tests', status: 'pending' },
          ]),
          h.editFile(
            'src/services/user-service.ts',
            'import { pool } from "../db/pool";',
            'import { IUserRepository } from "../repositories/types";\n\nexport class UserService {\n  constructor(private userRepo: IUserRepository) {}',
          ),
          h.editFile(
            'src/services/post-service.ts',
            'import { pool } from "../db/pool";',
            'import { IPostRepository } from "../repositories/types";\n\nexport class PostService {\n  constructor(private postRepo: IPostRepository) {}',
          ),
        ], { inputTokens: 55000, outputTokens: 3000 }),
      ],
    },

    // Step 6: Tests
    {
      delay: 2500,
      label: '🧪 Step 6: Writing + running tests',
      entries: (() => {
        const bashTool = h.bash('npm test');
        const bashId = h.getToolId(bashTool);
        return [
          h.assistantMessage([
            h.todoWrite([
              { content: 'Analyze current database usage patterns', status: 'completed' },
              { content: 'Create repository interfaces', status: 'completed' },
              { content: 'Implement UserRepository', status: 'completed' },
              { content: 'Implement PostRepository', status: 'completed' },
              { content: 'Update service layer to use repositories', status: 'completed' },
              { content: 'Add integration tests', status: 'in_progress' },
            ]),
            h.writeFile('src/__tests__/repositories.test.ts', '// 24 integration tests...'),
            bashTool,
          ], { inputTokens: 65000, outputTokens: 4000 }),
          h.toolResult(
            bashId,
            'stdout:\n  PASS  src/__tests__/user-repository.test.ts\n' +
            '  PASS  src/__tests__/post-repository.test.ts\n' +
            '  PASS  src/__tests__/user-service.test.ts\n' +
            '  PASS  src/__tests__/post-service.test.ts\n\n' +
            '  Tests:  24 passed, 24 total\n  Time:   3.8s\n',
          ),
        ];
      })(),
    },

    // Complete
    {
      delay: 2000,
      label: '✅ All done',
      entries: [
        h.assistantMessage([
          h.todoWrite([
            { content: 'Analyze current database usage patterns', status: 'completed' },
            { content: 'Create repository interfaces', status: 'completed' },
            { content: 'Implement UserRepository', status: 'completed' },
            { content: 'Implement PostRepository', status: 'completed' },
            { content: 'Update service layer to use repositories', status: 'completed' },
            { content: 'Add integration tests', status: 'completed' },
          ]),
          h.textBlock('Repository pattern refactoring complete! Created UserRepository and PostRepository with full TypeScript interfaces. Updated all services to use dependency injection. All 24 tests pass.'),
        ], { inputTokens: 75000, outputTokens: 1500 }),
      ],
      hooks: [h.hookIdle()],
    },
  ],
};
