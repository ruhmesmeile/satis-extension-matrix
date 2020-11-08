const requestPromise = require('request-promise');
const constants = require('constants');
const cheerio = require('cheerio');
const path = require('path');

const express = require('express');
const exphbs = require('express-handlebars');
const sassMiddleware = require('node-sass-middleware')

const semverRegex = require('semver-regex');
const semverDiff = require('semver-diff');

const bitbucketUsername = process.env.BITBUCKET_USERNAME;
const bitbucketPassword = process.env.BITBUCKET_PASSWORD;
const bitbucketHost = process.env.BITBUCKET_HOST;
const bitbucketPort = process.env.BITBUCKET_PORT;

const satisUsername = process.env.SATIS_USERNAME;
const satisPassword = process.env.SATIS_PASSWORD;
const satisHost = process.env.SATIS_HOST;

const baseDistributionName = process.env.BASE_DISTRIBUTION_NAME;

const satisRequestOptions = {
  uri: `https://${satisUsername}:${satisPassword}@${satisHost}/`,
  transform: function (body) {
    return cheerio.load(body);
  },
  agentOptions: {
    secureOptions: constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_TLSv1,
    ecdhCurve: 'auto'
  }
};

const distributionFileRequestOptions = function distributionFileRequestOptions(projectKey, file, branch) {
  return {
    uri: `https://${bitbucketHost}/projects/${projectKey}/repos/${baseDistributionName}/raw/${file}?at=refs%2Fheads%2F${branch}`,
    auth: {
      'user': bitbucketUsername,
      'pass': bitbucketPassword
    },
    agentOptions: {
      secureOptions: constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_TLSv1,
      ecdhCurve: 'auto',
    }
  };
};

const typo3CmsPackagistRequestOptions = function typo3CmsPackagistRequestOptions() {
  return {
    uri: 'https://packagist.org/packages/typo3/cms-core',
    transform: function (body) {
      return cheerio.load(body);
    },
    agentOptions: {
      secureOptions: constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_TLSv1,
      ecdhCurve: 'auto',
    }
  };
};

const requestSatisPromise = function requestSatisPromise() {
  const distributions = [];
  const extensions = [];

  return requestPromise(satisRequestOptions)
    .then(($) => {
      const extractDistributionData = function extractDistributionData(distributionElement) {
        let $distribution = $(distributionElement);
        let $gitUrl = $distribution.find('dt:contains(Releases)').next('dd').find('a:contains(dev-master)');

        return {
          "name": $distribution.find('.card-header').attr('id').replace('"', '').trim(),
          "gitUrl": $gitUrl.attr('href')
        };
      };

      const extractExtensionData = function extractExtensionData(extensionElement) {
        let $extension = $(extensionElement);
        let $distributionNames = $extension.find('dt:contains(Required by)').next('dd').find('a');
        let $allVersionLinks = $extension.find('dt:contains(Releases)').next('dd').find('a');
        let allVersionLinks = $allVersionLinks.toArray();

        currentVersionLink = allVersionLinks.find(version => semverRegex().test(version.firstChild.nodeValue));
        currentVersion = currentVersionLink.firstChild.nodeValue;

        let inDistributions = [];
        $distributionNames.each((index, element) => {
          inDistributions.push($(element).text());
        });

        return {
          "name": $extension.find('.card-header').attr('id').replace('"', '').trim(),
          "inDistributions": inDistributions,
          "currentVersion": currentVersion
        };
      };

      const extractDataFromPanel = function extractDataFromPanel(index, element) {
        let $element = $(element);

        if ($element.find(`.card-header a:contains(${baseDistributionName})`).length) {
          distributions.push(extractDistributionData(element));
        } else {
          extensions.push(extractExtensionData(element));
        }
      };

      const filterComposerLockToRmPackages = function filterComposerLockToRmPackages(composerLockBody) {
        const composerLockJSON = JSON.parse(composerLockBody);

        const rmPackages = composerLockJSON['packages'].filter(package => package.name.indexOf('/rm-') > -1 && package.name.indexOf('ruhmesmeile') > -1);
        const rmPackagesDev = composerLockJSON['packages-dev'].filter(package => package.name.indexOf('/rm-') > -1 && package.name.indexOf('ruhmesmeile') > -1);
        const thirdPartyPackages = composerLockJSON['packages'].filter(package => package.name.indexOf('/rm-') < 0);
        const thirdPartyPackagesDev = composerLockJSON['packages-dev'].filter(package => package.name.indexOf('/rm-') < 0);
        const projectPackages = composerLockJSON['packages'].filter(package => package.name.indexOf('/rm-') > -1 && package.name.indexOf('ruhmesmeile') < 0);
        const projectPackagesDev = composerLockJSON['packages-dev'].filter(package => package.name.indexOf('/rm-') > -1 && package.name.indexOf('ruhmesmeile') < 0);

        // TODO this signifies a difference in build process (general cms-include, vs. specific core)
        const typo3CoreExt = composerLockJSON['packages'].filter(package => (package.name === 'typo3/cms-core' || package.name === 'typo3/cms'));

        return [
          rmPackages,
          rmPackagesDev,
          thirdPartyPackages,
          thirdPartyPackagesDev,
          projectPackages,
          projectPackagesDev,
          typo3CoreExt[0].version.replace('v','')
        ];
      };

      const extractDistributionInfoFromComposerJson = function extractDistributionInfoFromComposerJson(composerJsonBody) {
        const composerJsonJSON = JSON.parse(composerJsonBody);

        let rmBambooProjectKey = '/';
        // TODO this signifies a difference in build process (where the bambooKey is stored)
        if (composerJsonJSON.extra['ruhmesmeile/rm-configuration'] && composerJsonJSON.extra['ruhmesmeile/rm-configuration'].rmBambooProjectKey) {
          rmBambooProjectKey = composerJsonJSON.extra['ruhmesmeile/rm-configuration'].rmBambooProjectKey;
        } else if (composerJsonJSON.extra['ruhmesmeile/rm-configuration'] && composerJsonJSON.extra['ruhmesmeile/rm-configuration'].settings.rmBambooProjectKey) {
          rmBambooProjectKey = composerJsonJSON.extra['ruhmesmeile/rm-configuration'].settings.rmBambooProjectKey;
        }

        return [
          composerJsonJSON.version,
          rmBambooProjectKey.substr(0,6)
        ];
      };

      const extractDistributionInfoFromWriteInstallFiles = function extractDistributionInfoFromWriteInstallFiles(writeInstallFilesBody) {
        const newFrontendIntegration = writeInstallFilesBody.indexOf('verdaccio') > 0;

        return [
          newFrontendIntegration
        ];
      };

      // TODO this should only run once per view, not per distribution
      /*const extractDistributionInfoFromTypo3CmsPackagist = function extractDistributionInfoFromTypo3CmsPackagist($) {
      return [
          $('.version-details .version-number').text()
        ];
      };*/
      
      
      $('#package-list .card').map(extractDataFromPanel);

      var promises = distributions.map(distribution => {
        const setRelationInSatis = function setRelationInSatis(extension) {
          let satisExtension = extensions.find(ext => ext.name === extension.name);
          extension['relationInSatis'] = satisExtension.inDistributions.includes(distribution.name);
          return extension;
        };

        const setCurrentVersion = function setCurrentVersion(extension) {
          let matchingExtension = extensions.find(ext => ext.name === extension.name);
          extension['currentVersion'] = matchingExtension.currentVersion;
          return extension;
        };

        const setVersionDiff = function setVersionDiff(extension) {
          let matchingExtension = extensions.find(ext => ext.name === extension.name);
          extension['versionDiff'] = semverDiff(extension.version, matchingExtension.currentVersion);
          return extension;
        };

        // gitUrl format: ssh://git@${bitbucketHost}:${bitbucketPort}/PROJECTKEY/${baseDistributionName}.git
        let distributionProjectKey = distribution.gitUrl.substring(
          distribution.gitUrl.indexOf(`${bitbucketPort}/`) + 5,
          distribution.gitUrl.indexOf(`/${baseDistributionName}.git`)
        );

        const requestComposerLockPromise = requestPromise(distributionFileRequestOptions(distributionProjectKey, 'composer.lock', 'master'))
          .then(filterComposerLockToRmPackages);
        const requestComposerJsonPromise = requestPromise(distributionFileRequestOptions(distributionProjectKey, 'composer.json', 'master'))
          .then(extractDistributionInfoFromComposerJson);
        const requestWriteInstallFilesPromise = requestPromise(distributionFileRequestOptions(distributionProjectKey, 'bamboo-specs/src/main/resources/build-distribution/03-write-install-files.sh', 'master'))
          .then(extractDistributionInfoFromWriteInstallFiles).catch(function (err) { if (err.statusCode === 404) { return [false]; } });
        const requestBackupTypo3Promise = requestPromise(distributionFileRequestOptions(distributionProjectKey, 'bamboo-specs/src/main/resources/distribution-deployment/util/backup-typo3.util.sh', 'master'))
          .then(function () { return [true]; }).catch(function (err) { if (err.statusCode === 404) { return [false]; } });
        const requestFrontendRcPromise = requestPromise(distributionFileRequestOptions(distributionProjectKey, '.rm-frontendrc.js', 'master'))
          .then(function () { return [true]; }).catch(function (err) { if (err.statusCode === 404) { return [false]; } });
        //const requestTypo3CmsPackagist = requestPromise(typo3CmsPackagistRequestOptions())
        //  .then(extractDistributionInfoFromTypo3CmsPackagist);

        return Promise.all([
          requestComposerLockPromise,
          requestComposerJsonPromise,
          requestWriteInstallFilesPromise,
          requestBackupTypo3Promise,
          requestFrontendRcPromise
        ]).then(function ([
          composerLock,
          composerJson,
          writeInstallFiles,
          backupTypo3,
          frontendRc
        ]) {
          distribution['extensions'] = {
            'master': { 
              'rm': composerLock[0],
              'third': composerLock[2],
              'project': composerLock[4]
            }
          };

          distribution['typo3CoreVersion'] = composerLock[6];
          distribution['rmDistVersion'] = composerJson[0];
          distribution['rmBambooProjectKey'] = composerJson[1];
          distribution['frontendIntegration'] = writeInstallFiles[0];
          distribution['backupTypo3'] = backupTypo3[0];
          distribution['newFrontend'] = frontendRc[0];

          distribution.extensions.master.rm.forEach(setRelationInSatis);
          distribution.extensions.master.rm.forEach(setCurrentVersion);
          distribution.extensions.master.rm.forEach(setVersionDiff);
          distribution.extensions.master.project.forEach(setRelationInSatis);

          // These (devExtensions) are not used for anything yet, might want to copy some more
          // forEach cases from above when starting to use these
          distribution['devExtensions'] = {
            'master': { 'rm': composerLock[1], 'third': composerLock[3], 'project': composerLock[5] }
          };

          distribution.devExtensions.master.rm.forEach(setRelationInSatis);
          distribution.devExtensions.master.rm.forEach(setCurrentVersion);
          distribution.devExtensions.master.rm.forEach(setVersionDiff);
          distribution.devExtensions.master.project.forEach(setRelationInSatis);

          return distribution;
        });
      });

      return Promise.all(promises).then(function (distributions) {
        const removeDuplicates = (array, property) => {
          let obj = {};
          return Object.keys(array.reduce((prev, next) => {
            if (!obj[next[property]]) obj[next[property]] = next;
            return obj;
          }, obj)).map((i) => obj[i]);
        }

        const removeNameFromProjectExtension = function removeNameFromProjectExtension(extension) {
          extension.name = extension.name.substring(
            extension.name.indexOf('/') + 1,
            extension.name.length
          );

          return extension;
        };

        const reduceToRmExtensions = function reduceToRmExtensions(accumulator, distribution) {
          return accumulator.concat([
            ...distribution.extensions.master.rm
          ]);
        };

        const reduceToThirdPartyExtensions = function reduceToThirdPartyExtensions(accumulator, distribution) {
          return accumulator.concat([
            ...distribution.extensions.master.third
          ]);
        };

        const reduceToProjectExtensions = function reduceToProjectExtensions(accumulator, distribution) {
          return accumulator.concat([
            ...distribution.extensions.master.project.map(removeNameFromProjectExtension)
          ]);
        };

        const allRmExtensions = removeDuplicates(distributions.reduce(reduceToRmExtensions, []), 'name');
        const allThirdPartyExtensions = removeDuplicates(distributions.reduce(reduceToThirdPartyExtensions, []), 'name');
        const allProjectExtensions = removeDuplicates(distributions.reduce(reduceToProjectExtensions, []), 'name');

        return {
          'currentTypo3CoreVersion': '10.4.9',
          'distributions': distributions,
          'allRmExtensions': allRmExtensions,
          'allThirdPartyExtensions': allThirdPartyExtensions,
          'allProjectExtensions': allProjectExtensions
        }
      })
    })
    .catch((err) => {
      console.log(err);
    });
}

const versionLink = function versionLink(extension) {
  // extension.source.url format: "ssh://git@${bitbucketHost}:${bitbucketPort}/PROJECTKEY/REPONAME.git"
  const repoName = extension.source.url.substring(
    extension.source.url.lastIndexOf('/') + 1,
    extension.source.url.indexOf('.git')
  );

  const projectKey = extension.source.url.substring(
    extension.source.url.indexOf(`${bitbucketPort}/`) + 5,
    extension.source.url.indexOf(repoName) - 1
  );

  return `https://${bitbucketHost}/projects/${projectKey}/repos/${repoName}/commits?until=refs%2Ftags%2F${extension.version}&merges=include`;
};

const versionDiffLink = function versionDiffLink(extension) {
  // extension.source.url format: "ssh://git@${bitbucketHost}:${bitbucketPort}/PROJECTKEY/REPONAME.git"
  const repoName = extension.source.url.substring(
    extension.source.url.lastIndexOf('/') + 1,
    extension.source.url.indexOf('.git')
  );

  const projectKey = extension.source.url.substring(
    extension.source.url.indexOf(`${bitbucketPort}/`) + 5,
    extension.source.url.indexOf(repoName) - 1
  );

  return `https://${bitbucketHost}/projects/${projectKey}/repos/${repoName}/compare/commits?targetBranch=refs%2Ftags%2F${extension.version}&sourceBranch=refs%2Ftags%2F${extension.currentVersion}`;
};

var app = express();
var hbs = exphbs.create({
  helpers: {
    extension: function (extensionFullName) {
      return extensionFullName.substring(
        extensionFullName.indexOf('/') + 1,
        extensionFullName.length
      );
    },
    version: function (distribution, extensionName) {
      let masterExtension = distribution.extensions.master.rm.find(ext => ext.name === extensionName);
      if (!masterExtension) {
        masterExtension = distribution.extensions.master.project.find(ext => ext.name.indexOf(extensionName) > -1);
      }

      return masterExtension
        ? new hbs.handlebars.SafeString(`
            <span class="diff diff--master diff--${masterExtension.versionDiff}">
              <a target="_blank" href="${versionLink(masterExtension)}">${masterExtension.version}</a> 
              <span class="currentVersion">
                (<a target="_blank" href="${versionDiffLink(masterExtension)}">${masterExtension.currentVersion}</a>)
              </span>
            </span>
          `)
        : new hbs.handlebars.SafeString('<span class="x">X</span>');
    },
    typo3Version: function (distributionCoreVersion, currentCoreVersion) {
      return new hbs.handlebars.SafeString(`
        <span class="diff diff--master diff--${semverDiff(distributionCoreVersion, currentCoreVersion)}">
          ${distributionCoreVersion}
          <span class="currentVersion">
            (${currentCoreVersion})
          </span>
        </span>
      `);
    },
    isDivider: function (category, parentIndex, index, options) {
      if (category === 'rm' && ((parentIndex == 0) && (index === 0))) {
        return options.fn(this);
      } else if (category === 'all' && ((parentIndex == 0) && (index === 0))) {
        return options.fn(this);
      } else {
        return options.inverse(this);
      }
    }
  },
  defaultLayout: 'main'
});

app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');

app.use(sassMiddleware({
  src: path.join(__dirname, 'src', 'scss'),
  dest: path.join(__dirname, 'public', 'css'),
  debug: true,
  outputStyle: 'compressed',
  includePaths: 'node_modules/compass-mixins/lib',
  prefix:  '/css'
}));
app.use(express.static('public'));

app.get('/', function (req, res) {
  requestSatisPromise().then((data) => {
    res.render('feature-matrix', data);
  });
});

app.listen(3000, "0.0.0.0");