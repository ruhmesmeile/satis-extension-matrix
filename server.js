const asyncHandler = require('express-async-handler');
const fetch = require('node-fetch');

//const constants = require('constants');
const cheerio = require('cheerio');
const path = require('path');

const express = require('express');
const exphbs = require('express-handlebars');
const sassMiddleware = require('node-sass-middleware')

const semverRegex = require('semver-regex');
const semverDiff = require('semver-diff');

const NodeCache = require('node-cache');
const fetchResultCache = new NodeCache();

const bitbucketUsername = process.env.BITBUCKET_USERNAME;
const bitbucketPassword = process.env.BITBUCKET_PASSWORD;
const bitbucketHost = process.env.BITBUCKET_HOST;
const bitbucketPort = process.env.BITBUCKET_PORT;

const satisUsername = process.env.SATIS_USERNAME;
const satisPassword = process.env.SATIS_PASSWORD;
const satisHost = process.env.SATIS_HOST;

const baseDistributionName = process.env.BASE_DISTRIBUTION_NAME;

const homepageCacheTtl = process.env.HOMEPAGE_CACHE_TTL || 600;
const fetchCacheTtl = process.env.FETCH_CACHE_TTL || 600;

const fetchUrl = async (url, authUser, authPass, method = 'GET') => {
  const cacheHit = fetchResultCache.get(url);

  if (cacheHit === undefined) {
    const headers = {};    
    if (authUser && authPass) headers['Authorization'] = `Basic ${Buffer.from(authUser + ":" + authPass).toString('base64')}`;

    const request = await fetch(url, { method, headers, });
    if (request.status === 404) throw new Error(`404; file ${url} was not found`);

    const requestBody = await request.text();
    fetchResultCache.set(url, requestBody, fetchCacheTtl);

    return requestBody;
  } else {
    return cacheHit;
  }
};

const distributionFileUrl = (projectKey, file, branch) => {
  return `https://${bitbucketHost}/projects/${projectKey}/repos/${baseDistributionName}/raw/${file}?at=refs%2Fheads%2F${branch}`;
};

const extractDistributionData = (distributionElement, $satisHomepage) => {
  const $distribution = $satisHomepage(distributionElement);
  const $gitUrl = $distribution.find('dt:contains(Releases)').next('dd').find('a:contains(dev-master)');

  return {
    "name": $distribution.find('.card-header').attr('id').replace('"', '').trim(),
    "gitUrl": $gitUrl.attr('href')
  };
};

const extractExtensionData = (extensionElement, $satisHomepage) => {
  const $extension = $satisHomepage(extensionElement);
  const $distributionNames = $extension.find('dt:contains(Required by)').next('dd').find('a');
  const $allVersionLinks = $extension.find('dt:contains(Releases)').next('dd').find('a');

  const allVersionLinks = $allVersionLinks.toArray();
  const currentVersionLink = allVersionLinks.find(version => semverRegex().test(version.firstChild.nodeValue));
  const currentVersion = currentVersionLink.firstChild.nodeValue;

  let inDistributions = [];
  $distributionNames.each((index, element) => inDistributions.push($satisHomepage(element).text()));

  return {
    "name": $extension.find('.card-header').attr('id').replace('"', '').trim(),
    "inDistributions": inDistributions,
    "currentVersion": currentVersion
  };
};

const extractDataFromPanelFn = ($satisHomepage, distributions, extensions) => {
  return (index, element) => {
    let $element = $satisHomepage(element);

    if ($element.find(`.card-header a:contains(${baseDistributionName})`).length) {
      distributions.push(extractDistributionData(element, $satisHomepage));
    } else {
      extensions.push(extractExtensionData(element, $satisHomepage));
    }
  }
};

const filterComposerLockToRmPackages = async (composerLockResponse) => {
  const composerLockJSON = JSON.parse(composerLockResponse);

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

const extractDistributionInfoFromComposerJson = async (composerJsonResponse) => {
  const composerJsonJSON = JSON.parse(composerJsonResponse);

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

const extractDistributionInfoFromWriteInstallFiles = async (writeInstallFilesResponse) => {
  const newFrontendIntegration = writeInstallFilesResponse.indexOf('verdaccio') > 0;

  return [
    newFrontendIntegration
  ];
};

const extractTypo3CMSVersionFromPackagist = async (typo3CmsPackagistResponse) => {
  const $typo3CmsPackagist = cheerio.load(typo3CmsPackagistResponse);
  const typo3CmsPackagistVersion = $typo3CmsPackagist('.version-details .version-number').text().replace('v','')

  return [
    typo3CmsPackagistVersion
  ];
};

const extractDataForDistribution = (extensions) => {
  return async (distribution) => {
    const setRelationInSatis = (extension) => {
      const satisExtension = extensions.find(ext => ext.name === extension.name);
      extension['relationInSatis'] = satisExtension.inDistributions.includes(distribution.name);
      return extension;
    };
  
    const setCurrentVersion = (extension) => {
      const matchingExtension = extensions.find(ext => ext.name === extension.name);
      extension['currentVersion'] = matchingExtension.currentVersion;
      return extension;
    };
  
    const setVersionDiff = (extension) => {
      const matchingExtension = extensions.find(ext => ext.name === extension.name);
      extension['versionDiff'] = semverDiff(extension.version, matchingExtension.currentVersion);
      return extension;
    };
  
    // gitUrl format: ssh://git@${bitbucketHost}:${bitbucketPort}/PROJECTKEY/${baseDistributionName}.git
    const distributionProjectKey = distribution.gitUrl.substring(
      distribution.gitUrl.indexOf(`${bitbucketPort}/`) + 5,
      distribution.gitUrl.indexOf(`/${baseDistributionName}.git`)
    );
  
    const composerLock = await fetchUrl(distributionFileUrl(distributionProjectKey, 'composer.lock', 'master'), bitbucketUsername, bitbucketPassword)
      .then(filterComposerLockToRmPackages).catch((err) => { if (err.message.indexOf('404') > -1) return [false]; });
    const composerJson = await fetchUrl(distributionFileUrl(distributionProjectKey, 'composer.json', 'master'), bitbucketUsername, bitbucketPassword)
      .then(extractDistributionInfoFromComposerJson).catch((err) => { if (err.message.indexOf('404') > -1) return [false]; });
    const writeInstallFiles = await fetchUrl(distributionFileUrl(distributionProjectKey, 'bamboo-specs/src/main/resources/build-distribution/03-write-install-files.sh', 'master'), bitbucketUsername, bitbucketPassword)
      .then(extractDistributionInfoFromWriteInstallFiles).catch((err) => { if (err.message.indexOf('404') > -1) return [false]; });
    const backupTypo3 = await fetchUrl(distributionFileUrl(distributionProjectKey, 'bamboo-specs/src/main/resources/distribution-deployment/util/backup-typo3.util.sh', 'master'), bitbucketUsername, bitbucketPassword)
      .then(() => [true]).catch((err) => { if (err.message.indexOf('404') > -1) return [false]; });
    const frontendRc = await fetchUrl(distributionFileUrl(distributionProjectKey, '.rm-frontendrc.js', 'master'), bitbucketUsername, bitbucketPassword)
      .then(() => [true]).catch((err) => { if (err.message.indexOf('404') > -1) return [false]; });
  
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
  };
};

const getMatrixData = async () => {
  const distributions = [];
  const extensions = [];

  const $satisHomepage = cheerio.load(await fetchUrl(`https://${satisHost}/`, satisUsername, satisPassword));
  $satisHomepage('#package-list .card').map(extractDataFromPanelFn($satisHomepage, distributions, extensions));

  return Promise.all(distributions.map(extractDataForDistribution(extensions))).then(async (distributions) => {
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
      return accumulator.concat([...distribution.extensions.master.rm]);
    };

    const reduceToThirdPartyExtensions = function reduceToThirdPartyExtensions(accumulator, distribution) {
      return accumulator.concat([...distribution.extensions.master.third]);
    };

    const reduceToProjectExtensions = function reduceToProjectExtensions(accumulator, distribution) {
      return accumulator.concat([...distribution.extensions.master.project.map(removeNameFromProjectExtension)]);
    };

    const allRmExtensions = removeDuplicates(distributions.reduce(reduceToRmExtensions, []), 'name');
    const allThirdPartyExtensions = removeDuplicates(distributions.reduce(reduceToThirdPartyExtensions, []), 'name');
    const allProjectExtensions = removeDuplicates(distributions.reduce(reduceToProjectExtensions, []), 'name');

    const currentTypo3CoreVersion = (await fetchUrl('https://packagist.org/packages/typo3/cms-core')
      .then(extractTypo3CMSVersionFromPackagist))[0];

    return {
      currentTypo3CoreVersion,
      distributions,
      allRmExtensions,
      allThirdPartyExtensions,
      allProjectExtensions
    }
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

app.get('/', asyncHandler(async (req, res) => {
  let matrixData;
  
  const cacheHit = fetchResultCache.get('matrixHomepage');

  if (cacheHit === undefined) {
    matrixData = await getMatrixData();
    fetchResultCache.set('matrixHomepage', matrixData, homepageCacheTtl);
  } else {
    matrixData = cacheHit;
  }

  res.render('feature-matrix', matrixData);
}));

app.listen(3000, "0.0.0.0");

/*

# TODO
* sort extensions by frequency (per category)
* add sensible links where applicable (typo3 systems, projects etc)
* move all assets to local hosting from CDNs
* add cache clear route for url / project / repository, integrate with docker-satis

*/