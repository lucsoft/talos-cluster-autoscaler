# Getting the token

```bash
pveum user add talos-autoscaler@pve
pveum aclmod / -user talos-autoscaler@pve -role Administrator # maybe this should be more restrictive.
pveum user token add talos-autoscaler@pve tas -privsep 0
```

<!-- 103dbed5-4953-47ec-a26a-0897d899bc9c -->