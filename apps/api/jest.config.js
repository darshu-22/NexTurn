module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { target: 'es2022', module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, skipLibCheck: true } }]
  }
};
