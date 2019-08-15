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
const transformRuntime = require('@babel/plugin-transform-runtime');
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

// if checkWatch is true and -w or --watch was passed to rollup
// we should "change the build" for rollups watch mode.
const shouldChangeWatch = (settings) =>
  settings.checkWatch && process.argv.some((arg) => (/^-w|--watch$/).test(arg));

// verify that listed plugins are an object or in primed plugins
const validatePlugins = ({plugins, primedPlugins}) =>
  Object.keys(plugins).forEach((buildType) => plugins[buildType].forEach((pluginName) => {
    if (typeof pluginName !== 'string') {
      return;
    }

    if (!primedPlugins[pluginName]) {
      throw new Error(`Plugin ${pluginName} listed in ${buildType} does not have an equivent Primed Plugin`);
    }
  }));
const MINJS_REGEX = /^.+\.min\.js$/;

// all complex defaults
// Note: the order here matters because one default often
// determines the value of another default
const ORDERED_DEFAULTS = {
  globals: () => ({
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
  }),
  externals: ({globals = {}}) => ({
    browser: [
    ].concat(Object.keys(globals.browser || {})),
    module: [
      'global',
      '@babel/runtime'
    ].concat(Object.keys(globals.module || {})),
    test: [
    ].concat(Object.keys(globals.test || {}))
  }),
  plugins: (settings) => ({
    browser: [
      'resolve',
      'json',
      'commonjs',
      'uglify',
      'babel'
    ],
    module: [
      'json',
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
    // filter out istanbul during watch or if coverage is false
      .filter((n) => !(n === 'istanbul' && (shouldChangeWatch(settings) || !settings.coverage)))
  }),
  babel: (settings) => ({
    externalHelpers: true,
    runtimeHelpers: true,
    babelrc: false,
    exclude: path.join(process.cwd(), 'node_modules/**'),
    compact: false,
    presets: [
      [presetEnv, {loose: true, modules: false, targets: {browsers: settings.browserslist}}]
    ],
    plugins: [
      [transformRuntime, {regenerator: false}],
      transformObjectAssign
    ]
  }),
  excludeCoverage: () => ['test/**', path.join(__dirname, '**'), 'node_modules/**', 'package.json'],
  primedPlugins: (settings) => ({
    babel: babel(settings.babel),
    commonjs: commonjs({sourceMap: false}),
    json: json(),
    multiEntry: multiEntry({exports: false}),
    resolve: resolve({
      mainFields: ['browser', 'module', 'jsnext:main', 'main'],
      dedupe: (id) => settings.externals.module.some((ext) => id.startsWith(ext))
    }),
    uglify: terser({output: {comments: 'some'}, include: [MINJS_REGEX]}),
    istanbul: istanbul({exclude: settings.excludeCoverage})
  })
};

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
  const pkg = getPackageJson();
  // package name minus scope
  const basicName = pkg.name.split('/').reverse()[0];
  const settings = Object.assign({
    input: 'src/plugin.js',
    testInput: 'test/**/*.test.js',
    distName: basicName,
    exportName: basicName.replace(/-(\w)/g, (matches, letter) => letter.toUpperCase()),
    browserslist: pkg.browserslist || ['defaults', 'ie 11'],
    checkWatch: true,
    banner: `/*! @name ${pkg.name} @version ${pkg.version} @license ${pkg.license} */`,
    coverage: true
  }, options || {});

  Object.keys(ORDERED_DEFAULTS).forEach(function(key) {
    const defaultValue = ORDERED_DEFAULTS[key](settings);

    if (typeof settings[key] === 'function') {
      settings[key] = settings[key](defaultValue);
    } else {
      settings[key] = defaultValue;
    }

  });

  // validate that plugin strings are valid
  validatePlugins(settings);

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
      external: (id) => buildSettings.externals[buildType].some((ext) => id.startsWith(ext)),
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
        // remove .min.js output if should change watch is true
      }].filter((o) => !(MINJS_REGEX.test(o.file) && shouldChangeWatch(settings)))
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

