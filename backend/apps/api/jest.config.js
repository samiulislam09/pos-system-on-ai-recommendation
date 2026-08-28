module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  collectCoverageFrom: ["src/**/*.(t|j)s"],
  coverageDirectory: "./coverage",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@inv/database$": "<rootDir>/../../packages/database/src/index.ts",
    "^@inv/config$": "<rootDir>/../../packages/config/src/index.ts",
    "^@inv/events$": "<rootDir>/../../packages/events/src/index.ts",
    "^@inv/types$": "<rootDir>/../../packages/types/src/index.ts",
    "^@inv/validation$": "<rootDir>/../../packages/validation/src/index.ts",
  },
};