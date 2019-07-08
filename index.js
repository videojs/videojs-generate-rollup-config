/**
 * Rollup configuration for packaging the plugin in various formats.
 */
const babel = require('rollup-plugin-babel');
const commonjs = require('rollup-plugin-commonjs');
const json = require('rollup-plugin-json');
const multiEntry = require('rollup-plugin-multi-entry');
const resolve = require('rollup-plugin-node-resolve');
const {terser} = require('rollup-plugin-terser');
const istanbul = require('rollup-plugin-istanbul');
const path = require('path');

const transformObjectAssign = require('@babel/plugin-transform-object-assign');
const presetEnv = require('@babel/preset-env');

/**
 * Get the package.json from the cwd and
 * validate that it has all the correct entries.
 *
 * @return {Object}
 *         The package.json from the current working
 *         directory.
 */
const getPackageJson = function() {
  const pkg = require(path.join(process.cwd(), 'package.json'));

  if (!pkg.name) {
    throw new Error('package.json does not have a `name` key/value');
  }

  if (!pkg.version) {
    throw new Error('package.json does not have a `version` key/value');
  }

  if (!pkg.license) {
    throw new Error('package.json does not have a `license` key/value');
  }

  return pkg;
};

const defaultGlobals = {
  browser: {
    'video.js': 'videojs',
    'global': 'window',
    'global/window': 'window',
    'global/document': 'document'
  },
  module: {
    'video.js': 'videojs'
  },
  test: {
    'qunit': 'QUnit',
    'qunitjs': 'QUnit',
    'sinon': 'sinon',
    'video.js': 'videojs'
  }
};

const defaultExternals = {
  browser: [],
  module: [
    'global',
    'global/document',
    'global/window'
  ],
  test: []
};

const defaultPlugins = {
  browser: [
    'resolve',
    'json',
    'commonjs',
    'uglify',
    'babel'
  ],

  module: [
    'resolve',
    'json',
    'commonjs',
    'babel'
  ],

  test: [
    'multiEntry',
    'resolve',
    'json',
    'commonjs',
    'istanbul',
    'babel'
  ]
};

/**
 * get the default primed plugins
 *
 * @param {Object} options
 *        options to use when getting the default primed plugins.
 *
 * @param {Object} options.browserslist
 *        The browserslist option, see the README for more details
 *
 * @return {Object}
 *         The default primed plugins
 */

/**
 * Merge defaults, provided options, and package.json
 * entries to get settings for this build.
 *
 * @param {Object} options
 *        Options provided to the generateRollupConfig
 *        function.
 *
 * @param {Object} pkg
 *        The entire package.json read from the current project
 *        directory
 *
 * @return {Object}
 *         The settings from merging options, defaults, and package.json
 */
const getSettings = function(options) {
  options = options || {};
  const pkg = getPackageJson();
  // package name minus scope
  const basicName = pkg.name
    .split('/')
    .reverse()[0];

  const settings = {
    // main entry file
    input: options.input || 'src/plugin.js',

    // test entry file
    testInput: options.testInput || 'test/**/*.test.js',

    // package name
    distName: options.distName || basicName,

    // package name minus scope to camel case
    exportName: options.exportName || basicName.replace(/-(\w)/g, (matches, letter) => letter.toUpperCase()),

    // used to determine what browsers to target
    browserslist: options.browserslist || pkg.browserslist || ['defaults', 'ie 11'],

    // remove the .min.js output and instanbul plugin automatically on rollup watch
    checkWatch: typeof options.checkWatch !== 'undefined' ? options.checkWatch : true,

    // globals, aka replace require calls with this
    globals: options.globals ? options.globals(Object.assign({}, defaultGlobals)) : defaultGlobals,

    // plugin order by build type
    plugins: options.plugins ? options.plugins(Object.assign({}, defaultPlugins)) : defaultPlugins,

    // banner to add to the top of all bundles
    banner: options.banner || `/*! @name ${pkg.name} @version ${pkg.version} @license ${pkg.license} */`,

    // ignore tests, external modules, and package.json
    excludeCoverage: ['test/**', path.join(__dirname, '**'), 'node_modules/**', 'package.json']
  };

  const defaultBabel = () => {
    return {
      babelrc: false,
      exclude: path.join(process.cwd(), 'node_modules/**'),
      presets: [
        [presetEnv, {loose: true, modules: false, targets: {browsers: settings.browserslist}}]
      ],
      plugins: [
        transformObjectAssign
      ]
    };
  };

  // get babel settings from the users provided function or use the defaults
  settings.babel = options.babel ? options.babel(defaultBabel()) : defaultBabel();

  if (options.excludeCoverage) {
    settings.excludeCoverage = options.excludeCoverage(settings.excludeCoverage);
  }

  // primed plugins
  settings.primedPlugins = {
    babel: babel(settings.babel),
    commonjs: commonjs({sourceMap: false}),
    json: json(),
    multiEntry: multiEntry({exports: false}),
    resolve: resolve({browser: true, mainFields: ['module', 'jsnext', 'main']}),
    uglify: terser({output: {comments: 'some'}, include: [/^.+\.min\.js$/]}),
    istanbul: istanbul({exclude: settings.excludeCoverage})
  };

  if (options.primedPlugins) {
    settings.primedPlugins = options.primedPlugins(settings.primedPlugins);
  }

  Object.keys(settings.plugins).forEach((buildType) => {

    // verify that listed plugins are an object or
    const verifyPlugins = (pluginName) => {
      if (typeof pluginName !== 'string') {
        return;
      }

      if (!settings.primedPlugins[pluginName]) {
        throw new Error(`Plugin ${pluginName} listed in ${buildType} does not have an equivent Primed Plugin`);
      }
    };

    settings.plugins[buildType].forEach(verifyPlugins);
  });

  // externals, aka don't bundle these and if not
  // listed as a global don't require them either
  settings.externals = Object.assign({}, defaultExternals);

  // move globals to externals
  settings.externals.browser = settings.externals.browser.concat(Object.keys(settings.globals.browser));
  settings.externals.module = settings.externals.module.concat(Object.keys(settings.globals.module));
  settings.externals.test = settings.externals.test.concat(Object.keys(settings.globals.test));

  if (options.externals) {
    settings.externals = options.externals(settings.externals);
  }

  return settings;
};

/**
 * Generate a rollup config for a project.
 *
 * @param {Object} [options]
 *        Options to create the build targets with. See the
 *        README for a full list.
 *
 * @return {Object}
 *         Returns an object with key/value for builds
 *         and a key/value for the settings that were used.
 *         Note that builds are exported as an Object, but
 *         they need to be exported to rollup as an Array.
 */
const generateRollupConfig = function(options) {
  const settings = getSettings(options);

  /* make a build with the specifed settings */
  const makeBuild = (buildType, buildOverrides, buildSettings = settings) => {
    const b = Object.assign({
      // never clear screen during watch
      watch: {clearScreen: false},
      // map plugin names from strings to primed plugins
      // but only if the plugin is a string and not a
      // primed plugin already.
      plugins: buildSettings.plugins[buildType].map((p) => typeof p !== 'string' ? p : buildSettings.primedPlugins[p]),
      external: buildSettings.externals[buildType],
      input: buildType === 'test' ? buildSettings.testInput : buildSettings.input
    }, buildOverrides);

    const changeOutput = (o) => Object.assign({
      banner: buildSettings.banner,
      globals: buildSettings.globals[buildType]
    }, o);

    // keep output a non-array
    b.output = (!Array.isArray(b.output) ? changeOutput(b.output) : b.output.map(changeOutput));

    return b;
  };

  /* all rollup builds by name. note only object values will be used */
  const builds = {
    test: makeBuild('test', {
      output: [{
        name: `${settings.exportName}Tests`,
        file: 'test/dist/bundle.js',
        format: 'iife'
      }]
    }),
    browser: makeBuild('browser', {
      output: [{
        name: settings.exportName,
        file: `dist/${settings.distName}.js`,
        format: 'umd'
      }, {
        name: settings.exportName,
        file: `dist/${settings.distName}.min.js`,
        format: 'umd'
      }]
    }),
    module: makeBuild('module', {
      output: [{
        file: `dist/${settings.distName}.cjs.js`,
        format: 'cjs'
      }, {
        file: `dist/${settings.distName}.es.js`,
        format: 'es'
      }]
    })
  };

  // if checkWatch is true and -w or --watch was passed to rollup
  if (settings.checkWatch && process.argv.some((arg) => (/^-w|--watch$/).test(arg))) {
    // remove .min.js output
    delete builds.browser.output[1];

    const testBuild = builds.test;
    const istanbulIndex = testBuild.plugins.indexOf(settings.primedPlugins.istanbul);

    // remove istanbul from test building during watch
    if (settings.primedPlugins.istanbul && istanbulIndex !== -1) {
      testBuild.plugins.splice(istanbulIndex, 1);
    }
  }

  if (process.env.TEST_BUNDLE_ONLY) {
    // only keep test output
    delete builds.module;
    delete builds.browser;
  } else if (process.env.NO_TEST_BUNDLE) {
    delete builds.test;
  }

  return {builds, settings, makeBuild};
};

module.exports = generateRollupConfig;

