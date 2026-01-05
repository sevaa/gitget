# Description

This extension provides a build/release task that downloads files and/or folders from an Azure DevOps 
Git repository. On the most basic level, the parameters specify a source (Git repo, branch, and path) and a local path, and
the contents of the former are downloaded into the latter.

It addresses a shortcoming in AzDevOps' native facility of using source control as the source of release artifacts,
specifically, the inability to limit the download scope to a subfolder. Also, it lets one combine
sources from Git and TFVC repositories within the same build definition.

The task doesn't clone the repository. It doesn't work across team collections (organizations), the current collection is used.
It does not work with Git repositories elsewhere (e. g. Github). Instead of a branch, you can specify a tag or a commit SHA1 hash.
It overwrites files without warning. If the target folder exists, it's not cleared before execution. If the
target path doesn't exist and the source Git path corresponds to a folder, a folder corresponding to the target path will be created.
If the source is a file, the target doesn't exist, and the target name ends with a directory separator (\ on Windows,
/ elsewhere), the target name will be treated a folder name and a folder will be created.

The task connects to AzDevOps with the distributed task context, that corresponds to an artificial entity
called "Project Collection Build Service". It's not an Active Directory user, but AzDevOps Web UI recognizes it
as a valid username, and lets one add it to groups and assign permissions to it.

# Prior art
There is an extension called [GitDownloader](https://marketplace.visualstudio.com/items?itemName=nobitagamer.GitDownloader), but that one
downloads an entire repository.

# See also
There is a [counterpart TFVC extension](https://marketplace.visualstudio.com/items?itemName=sevaalekseyev.tfvcget) that does the same for TFVC (aka "legacy source control) repositories.
