import type { Config } from "jest";

const config: Config = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest",
    "^.+\\.js$": "<rootDir>/jest-esm-transform.cjs"
  },
  transformIgnorePatterns: ["/node_modules/(?!.*(?:htmlparser2|domhandler|domutils|domelementtype|dom-serializer|entities|launder)/)"],
  collectCoverageFrom: ["src/**/*.(t|j)s"],
  coverageDirectory: "coverage",
  testEnvironment: "node"
};

export default config;
