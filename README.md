# Cluster Autoscaler for Talos Linux

The following cloud platforms are being considered for future integration with the Cluster Autoscaler for Talos Linux:

- Proxmox VE
- Hetzner Cloud
- Docker (testing purposes)

Pull requests are welcome! If you want to add support for more cloud platforms, feel free to open a PR. Contributions to expand compatibility are appreciated.

## How It Works

The Cluster Autoscaler for Talos Linux relies on a TLS connection between the Cluster Autoscaler and the Talos Cluster Autoscaler (TCA) component. This connection is established and managed using [cert-manager](https://cert-manager.io/), which automates the issuance and renewal of TLS certificates. By leveraging cert-manager, both components can authenticate and communicate securely, ensuring that scaling operations are performed safely and reliably.

## External gRPC Mode

This project uses the Cluster Autoscaler in [External gRPC](https://github.com/kubernetes/autoscaler/tree/2bdd964632bb252c678f7669e24801b2a29f40ab/cluster-autoscaler/cloudprovider/externalgrpc), utilizing the provided gRPC protos for integration.