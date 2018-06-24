const requestPromise = require('request-promise');
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
  }
};

const distributionComposerLockJSONRequestOptions = function distributionComposerLockJSONRequestOptions(projectKey, branch) {
  return {
    uri: `https://${bitbucketHost}/projects/${projectKey}/repos/${baseDistributionName}/raw/composer.lock?at=refs%2Fheads%2F${branch}`, 
    auth: {
      'user': bitbucketUsername,
      'pass': bitbucketPassword
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
        let $gitUrl = $distribution.find('strong:contains(Releases)').parent().next().find('a:contains(dev-master)');

        return {
          "name": $distribution.find('h3.package-title a.anchor').text().replace('"', '').trim(),
          "gitUrl": $gitUrl.attr('href')
        };
      };

      const extractExtensionData = function extractExtensionData(extensionElement) {
        let $extension = $(extensionElement);
        let $distributionNames = $extension.find('strong:contains(Required by)').parent().next().find('a');
        let $allVersionLinks = $extension.find('strong:contains(Releases)').parent().next().find('a');
        let allVersionLinks = $allVersionLinks.toArray();

        currentVersionLink = allVersionLinks.find(version => semverRegex().test(version.firstChild.nodeValue));
        currentVersion = currentVersionLink.firstChild.nodeValue;

        let inDistributions = [];
        $distributionNames.each((index, element) => {
          inDistributions.push($(element).text());
        });

        return {
          "name": $extension.find('h3.package-title a.anchor').text().replace('"', '').trim(),
          "inDistributions": inDistributions,
          "currentVersion": currentVersion
        };
      };

      const extractDataFromPanel = function extractDataFromPanel(index, element) {
        let $element = $(element);

        if ($element.find(`h3.package-title:contains(${baseDistributionName})`).length) {
          distributions.push(extractDistributionData(element));
        } else {
          extensions.push(extractExtensionData(element));
        }
      };

      const filterToRmPackages = function filterToRmPackages(packageLockBody) {
        let packageLockJSON = JSON.parse(packageLockBody);

        rmPackages = packageLockJSON['packages'].filter(package => package.name.indexOf('/rm-') > -1 && package.name.indexOf('ruhmesmeile') > -1);
        rmPackagesDev = packageLockJSON['packages-dev'].filter(package => package.name.indexOf('/rm-') > -1 && package.name.indexOf('ruhmesmeile') > -1);
        thirdPartyPackages = packageLockJSON['packages'].filter(package => package.name.indexOf('/rm-') < 0);
        thirdPartyPackagesDev = packageLockJSON['packages-dev'].filter(package => package.name.indexOf('/rm-') < 0);
        projectPackages = packageLockJSON['packages'].filter(package => package.name.indexOf('/rm-') > -1 && package.name.indexOf('ruhmesmeile') < 0 );
        projectPackagesDev = packageLockJSON['packages-dev'].filter(package => package.name.indexOf('/rm-') > -1 && package.name.indexOf('ruhmesmeile') < 0);

        return [rmPackages, rmPackagesDev, thirdPartyPackages, thirdPartyPackagesDev, projectPackages, projectPackagesDev];
      };

      $('.panel').map(extractDataFromPanel);

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

        const setDistributionVersionDiff = function setDistributionVersionDiff(extension) {
          let matchingExtension = distribution.extensions.develop.rm.find(ext => ext.name === extension.name);

          if(!matchingExtension) {
            matchingExtension = distribution.extensions.develop.project.find(ext => ext.name === extension.name);
          }

          if(matchingExtension) {
            extension['distributionVersionDiff'] = semverDiff(extension.version, matchingExtension.version);
          }
          
          return extension;
        };

        // gitUrl format: ssh://git@${bitbucketHost}:${bitbucketPort}/PROJECTKEY/${baseDistributionName}.git
        let distributionProjectKey = distribution.gitUrl.substring(
          distribution.gitUrl.indexOf(`${bitbucketPort}/`) + 5,
          distribution.gitUrl.indexOf(`/${baseDistributionName}.git`)
        );

        let requestDevelopPromise = requestPromise(distributionComposerLockJSONRequestOptions(distributionProjectKey, 'develop'))
          .then(filterToRmPackages);

        let requestMasterPromise = requestPromise(distributionComposerLockJSONRequestOptions(distributionProjectKey, 'master'))
          .then(filterToRmPackages);

        return Promise.all([requestDevelopPromise, requestMasterPromise]).then(function ([developPackages, masterPackages]) {
          distribution['extensions'] = {
            'develop': { 'rm': developPackages[0], 'third': developPackages[2], 'project': developPackages[4] },
            'master': { 'rm': masterPackages[0], 'third': masterPackages[2], 'project': masterPackages[4] }
          };
          
          distribution.extensions.develop.rm.forEach(setRelationInSatis);
          distribution.extensions.develop.rm.forEach(setCurrentVersion);
          distribution.extensions.develop.rm.forEach(setVersionDiff);
          distribution.extensions.develop.project.forEach(setRelationInSatis);
          
          distribution.extensions.master.rm.forEach(setRelationInSatis);
          distribution.extensions.master.rm.forEach(setCurrentVersion);
          distribution.extensions.master.rm.forEach(setVersionDiff);
          distribution.extensions.master.rm.forEach(setDistributionVersionDiff);
          distribution.extensions.master.project.forEach(setRelationInSatis);
          distribution.extensions.master.project.forEach(setDistributionVersionDiff);

          // These (devExtensions) are not used for anything yet, might want to copy some more
          // forEach cases from above when starting to use these
          distribution['devExtensions'] = {
            'develop': { 'rm': developPackages[1], 'third': developPackages[3], 'project': developPackages[5] },
            'master': { 'rm': masterPackages[1], 'third': masterPackages[3], 'project': masterPackages[5] }
          };

          distribution.devExtensions.develop.rm.forEach(setRelationInSatis);
          distribution.devExtensions.develop.rm.forEach(setCurrentVersion);
          distribution.devExtensions.develop.rm.forEach(setVersionDiff);
          distribution.devExtensions.develop.project.forEach(setRelationInSatis);

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
            ...distribution.extensions.develop.rm, 
            ...distribution.extensions.master.rm
          ]);
        };

        const reduceToThirdPartyExtensions = function reduceToThirdPartyExtensions(accumulator, distribution) {
          return accumulator.concat([
            ...distribution.extensions.develop.third, 
            ...distribution.extensions.master.third
          ]);
        };

        const reduceToProjectExtensions = function reduceToProjectExtensions(accumulator, distribution) {
          return accumulator.concat([
            ...distribution.extensions.develop.project.map(removeNameFromProjectExtension),
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

const distributionDiffLink = function distributionDiffLink(masterExtension, developExtension) {
  // extension.source.url format: "ssh://git@${bitbucketHost}:${bitbucketPort}/PROJECTKEY/REPONAME.git"
  const repoName = masterExtension.source.url.substring(
    masterExtension.source.url.lastIndexOf('/') + 1,
    masterExtension.source.url.indexOf('.git')
  );

  const projectKey = masterExtension.source.url.substring(
    masterExtension.source.url.indexOf(`${bitbucketPort}/`) + 5,
    masterExtension.source.url.indexOf(repoName) - 1
  );

  return `https://${bitbucketHost}/projects/${projectKey}/repos/${repoName}/compare/commits?targetBranch=refs%2Ftags%2F${masterExtension.version}&sourceBranch=refs%2Ftags%2F${developExtension.version}`;
}

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

      let developExtension = distribution.extensions.develop.rm.find(ext => ext.name === extensionName);
      if (!developExtension) {
        developExtension = distribution.extensions.develop.project.find(ext => ext.name.indexOf(extensionName) > -1);
      }

      return masterExtension && developExtension 
        ? new hbs.handlebars.SafeString(`
            <span class="diff diff--master diff--${masterExtension.versionDiff}">
              <a target="_blank" href="${versionLink(masterExtension)}">${masterExtension.version}</a> 
              <span class="currentVersion">
                (<a target="_blank" href="${versionDiffLink(masterExtension)}">${masterExtension.currentVersion}</a>)
              </span>
            </span>
            <span class="diff diff--develop diff--${developExtension.versionDiff}">
              <a target="_blank" href="${versionLink(developExtension)}">${developExtension.version}</a> 
              <span class="currentVersion">
                (<a target="_blank" href="${versionDiffLink(developExtension)}">${developExtension.currentVersion}</a>)
              </span>
            </span>
            <span class="diff diff--distribution diff--${masterExtension.distributionVersionDiff}">
              <a target="_blank" href="${versionLink(masterExtension)}">${masterExtension.version}</a> 
              <span class="currentVersion">
                (<a target="_blank" href="${distributionDiffLink(masterExtension, developExtension)}">${developExtension.version}</a>)
              </span>
            </span>
          `)
        : new hbs.handlebars.SafeString('<span class="x">X</span>');
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

app.listen(3000);