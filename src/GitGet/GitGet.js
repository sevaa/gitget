const tl = require("azure-pipelines-task-lib"),
    vso = require("azure-devops-node-api");
    fs = require("fs"),
    path = require("path");
const { GitVersionOptions,
    GitVersionType,
    GitObjectType,
    VersionControlRecursionType } = require("azure-devops-node-api/interfaces/GitInterfaces");

async function getFileFromSourceControl(cli, RepoID, GitPath, VerDesc, LocalPath)
{
    var ins = await cli.getItemContent(RepoID, GitPath, null, null, VersionControlRecursionType.None, false, false, false, VerDesc);
    ins.pipe(fs.createWriteStream(LocalPath));
}

function ensureFolderExistence(Path)
{
    if(!tl.exist(Path))
        fs.mkdirSync(Path, {recursive:true});
}

function makeLocalPath(GitPath, LocalPath, BaseLen)
{
    var RelPath = GitPath.substr(BaseLen);
    if(path.sep != "/")
        RelPath = RelPath.replace("/", path.sep);
    return path.join(LocalPath, RelPath);
}

async function getFolderFromSourceControl(cli, RepoID, Items, FolderQueue, LocalPath, BaseLen, VerDesc)
{
    var BaseGitPath = Items.reduce((min, it) => it.path.length < min.path.len ? it : min, Items[0]).path;
    console.log(BaseGitPath);
    for(var i=0;i<Items.length;i++)
    {
        var Item = Items[i];
        var ItemPath = Item.path;
        if(ItemPath != BaseGitPath)
        {
            var LocalItemPath = makeLocalPath(ItemPath, LocalPath, BaseLen);
            if(Item.gitObjectType == GitObjectType.Tree)
            {
                tl.debug("Enqueueing " + ItemPath);
                FolderQueue.push(Item);
            }
            else //It's a file
            {
                console.log(ItemPath);
                await getFileFromSourceControl(cli, RepoID, ItemPath, VerDesc, LocalItemPath);
            }
        }
    }
}

async function main()
{
    try
    {
        let conn;
        let RepoID, GitPath, LocalPath, Branch, Project;
         
        if(tl.getVariable("Agent.Version")) //Running from the agent
        {
            //Use the context connection - effectively the "Project Collection Build Service"
            const URL = tl.getEndpointUrl("SYSTEMVSSCONNECTION", false);
            //Contains collection (with on prem TFS) but no project
            const Token = tl.getEndpointAuthorizationParameter("SYSTEMVSSCONNECTION", "AccessToken", false);
            conn = vso.WebApi.createWithBearerToken(URL, Token, null);

            console.log(URL);

            RepoID = tl.getInput("Repo");
            GitPath = tl.getInput("GitPath");
            LocalPath = tl.getInput("LocalPath");
            Branch = tl.getInput("Branch");

            Project = tl.getVariable("System.TeamProject");
        }
        else //Interactive run
        {
            //TFS context passed through the environment variables - TFSURL and PAT
            conn = new vso.WebApi(process.env.TFSURL, vso.getPersonalAccessTokenHandler(process.env.PAT));

            //Parameters passed through the node.js command line
            RepoID = process.argv[2];
            GitPath = process.argv[3];
            LocalPath = process.argv[4];
            Branch = process.argv.length > 5 ? process.argv[5] : "";

            Project = process.env.PROJECT;
        }

        cli = await conn.getGitApi();

        if(!LocalPath)
        {
            LocalPath = tl.getVariable("System.DefaultWorkingDirectory");
            if(!LocalPath)
                LocalPath = ".";
        }

        if(!RepoID)
        {
            const Repos = await cli.getRepositories(Project, false, false);
            if(Repos.length > 1)
            {
                console.error(`There are multiple Git repositories in project ${Project}, please specify one.`);
                process.exit(1);
            }
            else if(Repos.length == 0)
            {
                console.error(`There are no Git repositories in project ${Project}. If the source repo is in another project, please specify it.`);
                process.exit(1);
            }
            
            RepoID = Repos[0].id;
            console.log(`Using repository ${Repos[0].name}.`);
        }


        let VerDesc;
        if(!Branch)
            VerDesc = null;
        else //TODO: how to get a list of tags?
        {
            const Refs = await cli.getRefs(RepoID);
            if(Refs.find(r => r.name == "refs/heads/" + Branch))
                VerDesc = {version: Branch, versionOptions:GitVersionOptions.None, versionType:GitVersionType.Branch};
            else if(Refs.find(r => r.name == "refs/tags/" + Branch))
                VerDesc = {version: Branch, versionOptions: GitVersionOptions.None, versionType: GitVersionType.Tag};
            else if(Branch.length == 40 && !Branch.split("").find(c => (c < '0' || c > '9') && (c < 'a' || c > 'f') && (c < 'A' || c > 'F')))
                VerDesc = {version: Branch, versionOptions:GitVersionOptions.None, versionType:GitVersionType.Commit};
            else
            {
                tl.error(`"${Branch}" is not a branch, not a tag, not a proper SHA1 hash.`);
                process.exit(1);                
            }
        }
       
        let Items = await cli.getItems(RepoID, null, GitPath, VersionControlRecursionType.OneLevel, false, false, false, false, VerDesc);
        if(!Items.length)
        {
            tl.error(GitPath + " was not found");
            process.exit(1);
        }
        else if(Items.length == 1 && Items[0].gitObjectType == GitObjectType.Blob) //It's a file
        {
            if(!tl.exist(LocalPath) && LocalPath.endsWith(path.sep))
                fs.mkdirSync(LocalPath, {recursive:true});

            if(tl.exist(LocalPath) && fs.statSync(LocalPath, {bigint:false}).isDirectory())
            {
                var FileName = Items[0].path.split("/").pop();
                LocalPath = path.join(LocalPath, FileName);
            }
            await getFileFromSourceControl(cli, RepoID, GitPath, VerDesc, LocalPath);
        }
        else //It's a folder - recurse...
        {
            if(tl.exist(LocalPath) && fs.statSync(LocalPath, {bigint:false}).isFile())
            {
                tl.error(LocalPath + " is a file, while " + GitPath + " is a folder.");
                process.exit(1);
            }

            // For easier production of relative paths
            if(!GitPath.endsWith("/"))
                GitPath += "/";
            const BaseLen = GitPath.length;
            ensureFolderExistence(LocalPath);
            const FolderQueue = [];
            await getFolderFromSourceControl(cli, RepoID, Items, FolderQueue, LocalPath, BaseLen, VerDesc);

            while(FolderQueue.length)
            {
                const Folder = FolderQueue.shift();
                const FolderPath = Folder.path;
                tl.debug("Dequeued " + FolderPath);
                const FolderLocalPath = makeLocalPath(FolderPath, LocalPath, BaseLen);
                ensureFolderExistence(FolderLocalPath);
                Items = await cli.getItems(RepoID, null, FolderPath, VersionControlRecursionType.OneLevel, false, false, false, false, VerDesc);
                await getFolderFromSourceControl(cli, RepoID, Items, FolderQueue, LocalPath, BaseLen, VerDesc);
            }
        }
    }
    catch(exc)
    {
        tl.error(exc.message);
        process.exit(1);
    }
}

main();

