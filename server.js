const requestPromise = require('request-promise');
const constants = require('constants');
const cheerio = require('cheerio');

const express = require('express');
const exphbs = require('express-handlebars');

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
        let composerLockJSON = JSON.parse(composerLockBody);

        rmPackages = composerLockJSON['packages'].filter(package => package.name.indexOf('/rm-') > -1 && package.name.indexOf('ruhmesmeile') > -1);
        rmPackagesDev = composerLockJSON['packages-dev'].filter(package => package.name.indexOf('/rm-') > -1 && package.name.indexOf('ruhmesmeile') > -1);
        thirdPartyPackages = composerLockJSON['packages'].filter(package => package.name.indexOf('/rm-') < 0);
        thirdPartyPackagesDev = composerLockJSON['packages-dev'].filter(package => package.name.indexOf('/rm-') < 0);
        projectPackages = composerLockJSON['packages'].filter(package => package.name.indexOf('/rm-') > -1 && package.name.indexOf('ruhmesmeile') < 0);
        projectPackagesDev = composerLockJSON['packages-dev'].filter(package => package.name.indexOf('/rm-') > -1 && package.name.indexOf('ruhmesmeile') < 0);

        return [rmPackages, rmPackagesDev, thirdPartyPackages, thirdPartyPackagesDev, projectPackages, projectPackagesDev];
      };

      const extractDistributionInfoFromComposerJson = function extractDistributionInfoFromComposerJson(composerJsonBody) {
        let composerJsonJSON = JSON.parse(composerJsonBody);

        return {
          version: composerJsonJSON.version,
          bambooProjectKey: (composerJsonJSON.extra['ruhmesmeile/rm-configuration']
                              && composerJsonJSON.extra['ruhmesmeile/rm-configuration'].rmBambooProjectKey) || '',
        };
      };
      
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

        let requestComposerLockPromise = requestPromise(distributionFileRequestOptions(distributionProjectKey, 'composer.lock', 'master'))
          .then(filterComposerLockToRmPackages);
        let requestComposerJsonPromise = requestPromise(distributionFileRequestOptions(distributionProjectKey, 'composer.json', 'master'))
          .then(extractDistributionInfoFromComposerJson);

        return Promise.all([requestComposerLockPromise, requestComposerJsonPromise]).then(function ([composerLock, composerJson]) {
          distribution['extensions'] = {
            'master': { 'rm': composerLock[0], 'third': composerLock[2], 'project': composerLock[4] }
          };

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
    isFirst: function (index, options) {
      if (index === 0){
         return options.fn(this);
      } else {
         return options.inverse(this);
      }
    },
    isSecond: function (index, options) {
      if (index === 1){
         return options.fn(this);
      } else {
         return options.inverse(this);
      }
    },
    isThird: function (index, options) {
      if (index === 2){
         return options.fn(this);
      } else {
         return options.inverse(this);
      }
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

app.use(express.static('public'));

app.get('/', function (req, res) {
  requestSatisPromise().then((data) => {
    res.render('feature-matrix', data);
  });
});

app.listen(3000, "0.0.0.0");