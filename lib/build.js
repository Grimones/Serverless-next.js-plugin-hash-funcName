const nextBuild = require("next/dist/build").default;
const path = require("path");
const fse = require("fs-extra");
const parseNextConfiguration = require("./parseNextConfiguration");
const logger = require("../utils/logger");
const copyBuildFiles = require("./copyBuildFiles");
const getNextPagesFromBuildDir = require("./getNextPagesFromBuildDir");
const rewritePageHandlers = require("./rewritePageHandlers");
const { v5: uuidV5 } = require('uuid');

const overrideTargetIfNotServerless = nextConfiguration => {
  const { target } = nextConfiguration;
  if (target !== "serverless") {
    logger.log(`Target "${target}" found! Overriding it with serverless`);
    nextConfiguration.target = "serverless";
  }
};

module.exports = async function() {
  const pluginBuildDir = this.pluginBuildDir;
  const nextConfigDir = pluginBuildDir.nextConfigDir;

  const [pageConfig, customHandler, routes] = this.getPluginConfigValues(
    "pageConfig",
    "customHandler",
    "routes"
  );

  logger.log("Started building next app ...");

  const servicePackage = this.serverless.service.package;
  const nextAwsLambdaPath = path.relative(
    nextConfigDir,
    path.dirname(require.resolve("next-aws-lambda"))
  );
  servicePackage.include = servicePackage.include || [];

  if (!servicePackage.individually) {
    servicePackage.include.push(path.posix.join(pluginBuildDir.posixBuildDir, '**'));
  }

  servicePackage.include.push(
    path.posix.join(nextAwsLambdaPath, "**", "*.js"),
    `!${path.posix.join(nextAwsLambdaPath, "**", "*.test.js")}`
  );

  const { nextConfiguration } = await parseNextConfiguration(nextConfigDir);

  overrideTargetIfNotServerless(nextConfiguration);

  await nextBuild(path.resolve(nextConfigDir), nextConfiguration);
  await copyBuildFiles(
    path.join(nextConfigDir, nextConfiguration.distDir),
    pluginBuildDir
  );

  if (customHandler) {
    await fse.copy(
      path.resolve(nextConfigDir, customHandler),
      path.join(pluginBuildDir.buildDir, customHandler)
    );
  }

  const nextPages = await getNextPagesFromBuildDir(pluginBuildDir.buildDir, {
    pageConfig,
    routes,
    additionalExcludes: customHandler
      ? [path.basename(customHandler)]
      : undefined
  });

  await rewritePageHandlers(nextPages, customHandler);

  const getFuncName = generateFunctionName();

  nextPages.forEach((page) => {
    const functionName = page.functionName;
    page.individually = servicePackage.individually;

    this.serverless.service.functions[getFuncName(functionName)] = page.serverlessFunction[functionName];
  });

  this.serverless.service.setFunctionNames();

  return nextPages;
};

function generateFunctionName() {
  const NAMESPACE = '00000000-0000-0000-0000-000000000000';
  return (functionName) => uuidV5(functionName, NAMESPACE);
}