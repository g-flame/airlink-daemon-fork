import { docker, parsePortBindings, parseEnvironmentVariables, initContainer } from './utils';
import { deleteContainer } from './delete';

export const startContainer = async (
    id: string,
    image: string,
    env: Record<string, string> = {},
    ports: string = '',
    Memory: number,
    Cpu: number
): Promise<void> => {
    try {
        console.log(`Deleting existing container with ID: ${id} (if any)...`);
        await deleteContainer(id);

        const volumePath = initContainer(id);
        const portBindings = parsePortBindings(ports);
        const modifiedEnv = parseEnvironmentVariables(env);

        console.log(`Creating and starting container ${id}...`);
        try {
            const stream = await docker.pull(image);
            await new Promise((resolve, reject) => {
                docker.modem.followProgress(stream, (err, result) => {
                    if (err) {
                        return reject(new Error(`Failed to pull image: ${err.message}`));
                    }
                    console.log(`Image ${image} pulled successfully.`);
                    resolve(result);
                });
            });
        } catch (err) {
            console.error(`Error pulling image ${image}:`, err);
            return;
        }

        const exposedPorts = Object.keys(portBindings).reduce((acc, port) => {
            acc[port] = {};
            return acc;
        }, {} as Record<string, {}>);

        await docker.createContainer({
            name: id,
            Image: image,
            Env: Object.entries(modifiedEnv).map(([key, value]) => `${key}=${value}`),
            HostConfig: {
            Binds: [`${volumePath}:/app/data`],
            PortBindings: portBindings,
            Memory: Memory * 1024 * 1024,
            CpuCount: Cpu,
            CapDrop: ["ALL"],
            SecurityOpt: ["no-new-privileges:true"],
            ReadonlyRootfs: true
            },
            ExposedPorts: exposedPorts,
            AttachStdout: true,
            AttachStderr: true,
            AttachStdin: true,
            OpenStdin: true,
            Tty: true,
        }).then((container) => container.start());
        
        console.log(`Container ${id} successfully started.`);
    } catch (error) {
        console.error(`Failed to start container ${id}: ${error}`);
    }
};

export const createInstaller = async (
    id: string,
    image: string,
    script: string,
    env: Record<string, string> = {},
): Promise<void> => {
    try {
        await deleteContainer('installer_' + id);

        const volumePath = initContainer(id);
        const modifiedEnv = parseEnvironmentVariables(env);

        console.log(`Creating and starting installer container installer_${id}...`);
        try {
            const stream = await docker.pull(image);
            await new Promise((resolve, reject) => {
                docker.modem.followProgress(stream, (err, result) => {
                    if (err) {
                        return reject(new Error(`Failed to pull image: ${err.message}`));
                    }
                    console.log(`Image ${image} pulled successfully.`);
                    resolve(result);
                });
            });
        } catch (err) {
            console.error(`Error pulling image ${image}:`, err);
            return;
        }

        const container = await docker.createContainer({
            name: 'installer_' + id,
            Image: image,
            Entrypoint: ['/bin/sh', '-c', script],
            Env: Object.entries(modifiedEnv).map(([key, value]) => `${key}=${value}`),
            HostConfig: {
                Binds: [`${volumePath}:/app/data`],
                AutoRemove: true,
                NetworkMode: 'host'
            }
        });

        await container.start();

        console.log(`Container installer_${id} successfully started.`);
    } catch (error) {
        console.error(`Failed to start container installer_${id}: ${error}`);
    }
};