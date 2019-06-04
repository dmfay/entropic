'use strict';

const isNamespaceMember = require('../decorators/is-namespace-member');
const packageExists = require('../decorators/package-exists');
const findInvitee = require('../decorators/find-invitee');
const canWrite = require('../decorators/can-write-package');
const Maintainer = require('../models/maintainer');
const Namespace = require('../models/namespace');
const Package = require('../models/package');
const { response, fork } = require('boltzmann');

module.exports = [
  fork.get(
    '/v1/packages/package/:namespace([^@]+)@:host/:name/maintainers',
    maintainers
  ),
  fork.post(
    '/v1/packages/package/:namespace([^@]+)@:host/:name/maintainers/:invitee',
    findInvitee(canWrite(invite))
  ),
  fork.del(
    '/v1/packages/package/:namespace([^@]+)@:host/:name/maintainers/:invitee',
    findInvitee(canWrite(remove))
  ),
  fork.post(
    '/v1/packages/package/:namespace([^@]+)@:host/:name/invitation/:member',
    packageExists(isNamespaceMember(accept))
  ),
  fork.del(
    '/v1/packages/package/:namespace([^@]+)@:host/:name/invitation/:member',
    packageExists(isNamespaceMember(decline))
  )
];

async function maintainers(context, { namespace, host, name }) {
  const [err, maintainers] = await context.storageApi.getActiveMaintainers({namespace, host, name, page: 0}).then(
    xs => [null, xs],
    xs => [xs, null]
  )

  if (err) {
    if (err.status === 404) {
      return response.error(
        `"${namespace}@${host}/${name}" does not exist.`,
        404
      );
    }

    context.logger.error(err.message || err)
    return response.error(
      `Caught error fetching maintainers for "${namespace}@${host}/${name}".`,
      500
    );
  }
  return response.json({ objects });
}

// Invite a maintainer. Maintainers are namespaces, which might be a single user or a group of users.
// More correctly: maintainership is a relationship between a namespace and a package.
async function invite(context, { namespace, host, name, invitee }) {
  const [err, invite] = await context.storageApi.inviteMaintainer({
    namespace,
    host,
    name,
    from: context.user.name,
    to: invitee
  }).then(
    xs => [null, xs],
    xs => [xs, null]
  )

  if (err) {
    const msg = {
      'invite.invitee_dne': `Unknown namespace: "${invitee}".`,
      'invite.package_dne': `Unknown package: "${invitee}".`,
      'invite.already_accepted': `Namespace "${invitee}" is already a member.`,
      'invite.already_declined': `Namespace "${invitee}" has declined this invite.`
    }[err.code]
    return response.error(
      msg || `Caught error inviting "${invitee}" to ${namespace}@${host}/${name}`,
      err.code
    );
  }

  context.logger.info(
    `${invitee} invited to join the maintainers of ${namespace}@${host}/${name} by ${
      context.user.name
    }`
  );
  return response.message(
    `${invitee} invited to join the maintainers of ${namespace}@${host}/${name}.`
  );
}

async function remove(context, { namespace, host, name, invitee }) {
  const [err, invite] = await context.storageApi.removeMaintainer({
    namespace,
    host,
    name,
    from: context.user.name,
    to: invitee
  }).then(
    xs => [null, xs],
    xs => [xs, null]
  )

  if (err) {
    const msg = {
      'invite.invitee_dne': `Unknown namespace: "${invitee}".`,
      'invite.invitee_not_maintainer': `${invitee} was not a maintainer of ${namespace}@${host}/${name}.`
      'invite.package_dne': `Unknown package: "${invitee}".`,
      'invite.already_accepted': `Namespace "${invitee}" is already a member.`,
      'invite.already_declined': `Namespace "${invitee}" has declined this invite.`
    }[err.code]

    return response.error(
      msg || `Caught error inviting "${invitee}" to ${namespace}@${host}/${name}`,
      err.code
    );
  }

  context.logger.info(
    `${invitee} removed as maintainer of ${namespace}@${host}/${name} by ${
      context.user.name
    }`
  );

  return response.message(
    `${invitee} removed as maintainer of ${namespace}@${host}/${name}.`
  );
}

async function accept(context, { namespace, host, name, member }) {
  const [err] = await context.storageApi.acceptMaintainerInvite({
    namespace,
    host,
    name,
    member,
    bearer: context.user.name
  }).then(
    xs => [null, xs],
    xs => [xs, null]
  )
  context.logger.info(
    `${
      context.user.name
    } accepted the invitation for ${member} to join ${namespace}@${host}/${name}`
  );
  return response.message(
    `${member} is now a maintainer for ${namespace}@${host}/${name}`
  );
}

async function decline(context, { namespace, host, name, member }) {
  const invitation = await Maintainer.objects
    .get({
      namespace_id: context.member.id,
      package_id: context.pkg.id,
      active: true,
      accepted: false
    })
    .catch(Maintainer.objects.NotFound, () => null);

  if (!invitation) {
    return response.error('invitation not found', 404);
  }

  await Maintainer.objects
    .filter({
      id: invitation.id
    })
    .update({
      modified: new Date(),
      active: false
    });

  context.logger.info(
    `${
      context.user.name
    } declined the invitation for ${member} to join ${namespace}@${host}/${name}`
  );
  return response.message(
    `You have declined the invitation for ${member} to join ${namespace}@${host}/${name}`
  );
}
