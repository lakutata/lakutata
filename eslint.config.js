import {defineConfig, globalIgnores} from 'eslint/config'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'
import globals from 'globals'

export default defineConfig([
    globalIgnores(['**/node_modules/', '**/dist/', '**/distro/', 'proposal/']),
    {
        files: ['**/*.ts', '**/*.mts', '**/*.cts'],
        extends: [js.configs.recommended, tseslint.configs.recommended],
        plugins: {
            '@stylistic': stylistic
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.node
        },
        rules: {
            //The style: single quotes (other quotes only to avoid escaping), no semicolons, no trailing commas
            '@stylistic/quotes': ['error', 'single', {avoidEscape: true, allowTemplateLiterals: 'always'}],
            '@stylistic/semi': ['error', 'never'],
            '@stylistic/comma-dangle': ['error', 'never'],
            '@stylistic/no-extra-semi': 'error',
            //A destructuring is const when all its variables are
            'prefer-const': ['error', {destructuring: 'all'}],
            //An import of a module per file (the type imports inline: import {type A, B})
            'no-duplicate-imports': 'error',
            //@ts-ignore keeps ignoring once the error is gone, @ts-expect-error fails then: it is used with its reason
            '@typescript-eslint/ban-ts-comment': ['error', {
                'ts-ignore': true,
                'ts-nocheck': true,
                'ts-expect-error': 'allow-with-description'
            }],
            //The parameters kept for a signature start with an underscore
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrors: 'none'
            }],
            //The framework relies on these constructs
            'prefer-spread': 'off',
            'prefer-rest-params': 'off',
            'no-constant-condition': 'off',
            'no-control-regex': 'off',
            'no-useless-escape': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-namespace': 'off',
            '@typescript-eslint/no-this-alias': 'off',
            '@typescript-eslint/no-unnecessary-type-constraint': 'off',
            '@typescript-eslint/no-unsafe-function-type': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-wrapper-object-types': 'off',
            '@typescript-eslint/no-unused-expressions': ['error', {allowShortCircuit: true, allowTernary: true}]
        }
    },
    {
        //The test suites ported from the upstream libraries are not type checked
        files: ['**/tests/**/*.ts'],
        rules: {
            '@typescript-eslint/ban-ts-comment': ['error', {
                'ts-ignore': true,
                'ts-nocheck': false,
                'ts-expect-error': 'allow-with-description'
            }]
        }
    },
    {
        files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
        extends: [js.configs.recommended],
        plugins: {
            '@stylistic': stylistic
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.node
        },
        rules: {
            '@stylistic/quotes': ['error', 'single', {avoidEscape: true, allowTemplateLiterals: 'always'}],
            '@stylistic/semi': ['error', 'never'],
            '@stylistic/comma-dangle': ['error', 'never']
        }
    }
])
